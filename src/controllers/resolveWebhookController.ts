/**
 * Controller: Resolve Incoming Webhook Event
 */
import { Request, Response, NextFunction } from 'express';
import {
    SuccessResponse,
    ErrorResponse,
    WebhookStatus,
    UtilitySecretType,
    Webhook,
    WebhookResolutionRequest
} from '@agent-base/types';
import { UserWebhookRecord, WebhookAgentLinkRecord } from '../types/db.js';
import {
    getWebhookByProviderAndEvent,
    mapWebhookRecordToWebhook
} from '../services/webhookDefinitionService.js';
import {
    findUserWebhookByIdentifierHash,
} from '../services/userWebhookLinkService.js';
import {
    findAgentLink,
} from '../services/agentWebhookLinkService.js';
import { computeIdentifierHash } from '../lib/crypto.js';
import { extractValueFromJson } from '../lib/jsonUtils.js';
import { appConfig } from '../index.js';

// --- Helper: Find Webhook Definition --- 
// Accept string for webhookProviderId as it comes from URL params
async function _findAndValidateWebhookDefinition(webhookProviderId: string, subscribedEventId: string): Promise<Webhook | null> {
    const webhookRecord = await getWebhookByProviderAndEvent(webhookProviderId, subscribedEventId);
    if (!webhookRecord) {
        console.warn(`Webhook definition not found for provider ${webhookProviderId}, event ${subscribedEventId}`);
        return null;
    }
    // mapWebhookRecordToWebhook returns the correct Webhook type
    return mapWebhookRecordToWebhook(webhookRecord);
}

// --- Helper: Extract & Hash Identifiers --- 
// Returns { hash: string } on success, or ErrorResponse on failure
function _extractAndHashIdentifiers(webhook: Webhook, payload: any): { hash: string } | ErrorResponse {
    const identifierValues: Record<string, any> = {};
    const requiredSecretsForIdentification = Object.keys(webhook.clientUserIdentificationMapping) as UtilitySecretType[];

    for (const secretType of requiredSecretsForIdentification) {
        const mappingPath = webhook.clientUserIdentificationMapping[secretType];
        if (!mappingPath) {
            // This error indicates a problem with the webhook definition itself.
            console.error(`Mapping path missing for identifying secret ${secretType} in webhook ${webhook.id}`);
            return {
                    success: false,
                    error: 'Webhook Configuration Error',
                    details: `The webhook definition (ID: ${webhook.id}) is misconfigured. It's missing the JSONPath mapping for the identifying secret type '${secretType}' in its 'clientUserIdentificationMapping'.`,
                    hint: `Update the webhook definition (ID: ${webhook.id}) to include a valid JSONPath in 'clientUserIdentificationMapping' for the secret type '${secretType}'. This path is used to extract the identifier from the webhook payload.`
                } as ErrorResponse;
        }
        const value = extractValueFromJson(payload, mappingPath);
        if (value === undefined || value === null) {
            // This error indicates the payload is missing expected data.
            return {
                    success: false,
                    error: 'Bad Request',
                    details: `The webhook payload is missing the required identifier for secret type '${secretType}'. The webhook definition expects this to be found at payload path '${mappingPath}'.`,
                    hint: `Ensure the external service sending the webhook includes the data for '${secretType}' at the JSONPath '${mappingPath}' in the payload. Alternatively, if the path is incorrect, update the 'clientUserIdentificationMapping' in the webhook definition.`
                } as ErrorResponse;
        }
        identifierValues[secretType] = value;
    }

    if (!appConfig.hmacKey) {
        // This is an internal server configuration issue.
        console.error("HMAC secret key not available in appConfig.");
        return {
                success: false,
                error: 'Internal Server Error',
                details: "The server is missing the necessary HMAC secret key for hashing identifiers. This is an internal configuration issue.",
                hint: "Contact the system administrator. The HMAC_KEY environment variable or configuration for the webhook service needs to be set."
            } as ErrorResponse;
    }
    const hash = computeIdentifierHash(identifierValues, appConfig.hmacKey);
    return { hash };
}

// --- Helper: Find User & Agent Links --- 
// Returns { userLink: UserWebhookRecord, agentLink: WebhookAgentLinkRecord } on success, or ErrorResponse on failure
async function _findUserAndAgentLinks(webhookId: string, identificationHash: string, webhookProviderIdForHint: string, subscribedEventIdForHint: string): Promise<{ userLink: UserWebhookRecord, agentLink: WebhookAgentLinkRecord } | ErrorResponse> {
    const userWebhookRecord = await findUserWebhookByIdentifierHash(webhookId, identificationHash);
    if (!userWebhookRecord) {
        return {
                success: false,
                error: 'Not Found',
                details: `No active user webhook link was found for webhook definition (Provider: '${webhookProviderIdForHint}', Event: '${subscribedEventIdForHint}', Webhook ID: '${webhookId}') using the identifiers derived from the payload.`,
                hint: `Ensure the user has authorized/linked this webhook (ID: ${webhookId}). Verify that the 'clientUserIdentificationMapping' in the webhook definition correctly extracts identifiers from the payload that match an existing, active user link.`
            } as ErrorResponse;
    }
    if (userWebhookRecord.status !== WebhookStatus.ACTIVE) {
         return {
                success: false,
                error: 'Forbidden',
                details: `A user webhook link was found for webhook ID '${webhookId}' (Provider: '${webhookProviderIdForHint}', Event: '${subscribedEventIdForHint}') and the provided payload identifiers, but its status is '${userWebhookRecord.status}', not '${WebhookStatus.ACTIVE}'.`,
                hint: `The user associated with these identifiers may need to reactivate or re-authorize this webhook link (ID: ${webhookId}). Check the status of the user's webhook link; it must be '${WebhookStatus.ACTIVE}'.`
            } as ErrorResponse;
    }
    const { client_user_id, platform_user_id } = userWebhookRecord;

    const agentLinkRecord = await findAgentLink(webhookId, client_user_id, platform_user_id);
    if (!agentLinkRecord) {
        return {
                success: false,
                error: 'Not Found',
                details: `A user link was found for webhook ID '${webhookId}' (Provider: '${webhookProviderIdForHint}', Event: '${subscribedEventIdForHint}', Client User ID: ${client_user_id}, Platform User ID: ${platform_user_id}), but no AI agent is linked to handle events for this user and webhook.`,
                hint: `Ensure an AI agent is configured and linked to handle webhook ID '${webhookId}' for this specific user (Client User ID: ${client_user_id}, Platform User ID: ${platform_user_id}).`
            } as ErrorResponse;
    }
    return { userLink: userWebhookRecord, agentLink: agentLinkRecord };
}

// --- Controller: resolveWebhookController --- 
export const resolveWebhookController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { webhookProviderId, subscribedEventId, payload }: WebhookResolutionRequest = req.body;
        if (!webhookProviderId || !subscribedEventId || !payload || typeof payload !== 'object') {
            // Corrected to send HTTP response directly
            return res.status(400).json({
                success: false,
                error: 'Bad Request',
                details: "The webhook resolution request is missing one or more required top-level fields: 'webhookProviderId', 'subscribedEventId', or 'payload'. The 'payload' must be a valid JSON object.",
                hint: "Ensure your request body to the /resolve endpoint includes: a 'webhookProviderId' (string), a 'subscribedEventId' (string), and a 'payload' (JSON object)."
            } as ErrorResponse);
        }
        
        const webhook = await _findAndValidateWebhookDefinition(webhookProviderId, subscribedEventId);
        if (!webhook) {
             // Corrected to send HTTP response directly
             return res.status(404).json({
                success: false,
                error: 'Not Found',
                details: `Webhook definition not found for provider ID '${webhookProviderId}' and event ID '${subscribedEventId}'.`,
                hint: "Verify that a webhook definition exists and is correctly configured in the system for this provider and event ID. You may need to create or update the webhook definition with these identifiers."
            } as ErrorResponse);
        }

        const hashResult = _extractAndHashIdentifiers(webhook, payload);
        // Check if hashResult is an ErrorResponse by looking for the 'error' property
        if ('error' in hashResult) {
            const errorResponse = hashResult as ErrorResponse;
            const statusCode = (errorResponse.error === 'Internal Server Error' || errorResponse.error === 'Webhook Configuration Error') ? 500 : 400;
            return res.status(statusCode).json(errorResponse);
        }
        // If not an error, hashResult is { hash: string }, so hashResult.hash is safe to access
        const identificationHash = hashResult.hash;

        const linkResult = await _findUserAndAgentLinks(webhook.id, identificationHash, webhookProviderId, subscribedEventId);
        // Check if linkResult is an ErrorResponse by looking for the 'error' property
        if ('error' in linkResult) {
            const errorResponse = linkResult as ErrorResponse;
            const statusCode = errorResponse.error === 'Forbidden' ? 403 : (errorResponse.error === 'Not Found' ? 404 : 500);
            return res.status(statusCode).json(errorResponse);
        }
        // If not an error, linkResult is { userLink: ..., agentLink: ... }
        // userLink and agentLink are guaranteed to be present due to the structure of the success return type
        const { client_user_id: clientUserId, platform_user_id: platformUserId } = linkResult.userLink;
        const { agent_id: agentId } = linkResult.agentLink;

        const conversationIdPath = webhook.conversationIdIdentificationMapping;
        const conversationId = extractValueFromJson(payload, conversationIdPath);
        
        const responseData = {
            clientUserId,
            platformUserId,
            agentId,
            conversationId: conversationId !== null && conversationId !== undefined ? String(conversationId) : null
        };
        const response: SuccessResponse<typeof responseData> = { success: true, data: responseData };
        res.status(200).json(response);

    } catch (error) {
        console.error('[Controller Error] Resolve Webhook:', error);
        next(error);
    }
}; 