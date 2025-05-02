/**
 * Controller: Resolve Incoming Webhook Event
 */
import { Request, Response, NextFunction } from 'express';
import {
    ServiceResponse,
    SuccessResponse,
    ErrorResponse,
    WebhookStatus,
    UtilitySecretType,
    Webhook,
    UtilityProvider,
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
function _extractAndHashIdentifiers(webhook: Webhook, payload: any): { hash?: string; errorResponse?: ErrorResponse } {
    const identifierValues: Record<string, any> = {};
    const requiredSecretsForIdentification = Object.keys(webhook.clientUserIdentificationMapping) as UtilitySecretType[];

    for (const secretType of requiredSecretsForIdentification) {
        const mappingPath = webhook.clientUserIdentificationMapping[secretType];
        if (!mappingPath) {
            console.error(`Mapping path missing for identifying secret ${secretType} in webhook ${webhook.id}`);
            return { errorResponse: { success: false, error: 'Webhook Configuration Error', message: 'Webhook definition is missing required mapping path.' } };
        }
        const value = extractValueFromJson(payload, mappingPath);
        if (value === undefined || value === null) {
            return { errorResponse: { success: false, error: 'Bad Request', message: `Missing required identifier '${secretType}' in webhook payload.` } };
        }
        identifierValues[secretType] = value;
    }

    if (!appConfig.hmacKey) {
        console.error("HMAC secret key not available in appConfig.");
        return { errorResponse: { success: false, error: 'Internal Server Error', message: 'Server configuration error.' } };
    }
    const hash = computeIdentifierHash(identifierValues, appConfig.hmacKey);
    return { hash };
}

// --- Helper: Find User & Agent Links --- 
async function _findUserAndAgentLinks(webhookId: string, identificationHash: string): Promise<{ userLink?: UserWebhookRecord; agentLink?: WebhookAgentLinkRecord; errorResponse?: ErrorResponse }> {
    const userWebhookRecord = await findUserWebhookByIdentifierHash(webhookId, identificationHash);
    if (!userWebhookRecord) {
        return { errorResponse: { success: false, error: 'Not Found', message: 'Webhook link not found for this user/payload.' } };
    }
    if (userWebhookRecord.status !== WebhookStatus.ACTIVE) {
         return { errorResponse: { success: false, error: 'Forbidden', message: 'Webhook link is not active.' } };
    }
    const { client_user_id, platform_user_id } = userWebhookRecord;

    const agentLinkRecord = await findAgentLink(webhookId, client_user_id, platform_user_id);
    if (!agentLinkRecord) {
        return { errorResponse: { success: false, error: 'Not Found', message: 'Agent not linked for this webhook user.' } };
    }
    return { userLink: userWebhookRecord, agentLink: agentLinkRecord };
}

// --- Controller: resolveWebhookController --- 
export const resolveWebhookController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Use string type directly from params
        const { webhookProviderId, subscribedEventId, payload }: WebhookResolutionRequest = req.body;
        if (!webhookProviderId || !subscribedEventId || !payload || typeof payload !== 'object') {
            return res.status(400).json({ success: false, error: 'Bad Request', message: 'Missing provider, event ID, or valid payload.' });
        }
        
        // No casting needed here anymore
        const webhook = await _findAndValidateWebhookDefinition(webhookProviderId, subscribedEventId);
        if (!webhook) {
             return res.status(404).json({ success: false, error: 'Not Found', message: 'Webhook definition not found.' });
        }

        const hashResult = _extractAndHashIdentifiers(webhook, payload);
        if (hashResult.errorResponse) {
            const statusCode = (hashResult.errorResponse.error === 'Internal Server Error' || hashResult.errorResponse.error === 'Webhook Configuration Error') ? 500 : 400;
            return res.status(statusCode).json(hashResult.errorResponse);
        }
        const identificationHash = hashResult.hash!;

        const linkResult = await _findUserAndAgentLinks(webhook.id, identificationHash);
        if (linkResult.errorResponse) {
             const statusCode = linkResult.errorResponse.error === 'Forbidden' ? 403 : 404;
             return res.status(statusCode).json(linkResult.errorResponse);
        }
        const { client_user_id: clientUserId, platform_user_id: platformUserId } = linkResult.userLink!;
        const { agent_id: agentId } = linkResult.agentLink!;

        const conversationIdPath = webhook.conversationIdIdentificationMapping;
        const conversationId = extractValueFromJson(payload, conversationIdPath);
        
        const responseData = {
            clientUserId,
            platformUserId,
            agentId,
            conversationId: conversationId !== null && conversationId !== undefined ? String(conversationId) : null
        };
        const response: SuccessResponse<typeof responseData> = { success: true, data: responseData };
        console.log('DEBUG: Resolve Webhook Response:', JSON.stringify(response));
        res.status(200).json(response);

    } catch (error) {
        console.error('[Controller Error] Resolve Webhook:', error);
        next(error);
    }
}; 