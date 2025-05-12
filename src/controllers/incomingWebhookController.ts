/**
 * Controller: Resolve Incoming Webhook Event
 * This controller handles validated incoming webhook events, resolves them to a specific user and agent,
 * and extracts necessary identifiers for further processing.
 */
import { Request, Response, NextFunction } from 'express';
import {
    SuccessResponse,
    ErrorResponse,
    AgentUserWebhook,     // For the linked agent
    UserWebhook,
    Webhook,
    ServiceResponse,          // For the validated user webhook link
    // WebhookStatus,     // No longer checking status here, service does
} from '@agent-base/types';
import { WebhookRecord } from '../types/db.js'; // For the webhook definition details
import {
    findUserWebhookBySecret, // New service function
} from '../services/userWebhookLinkService.js';
import {
    findAgentLink,
} from '../services/agentWebhookLinkService.js';
import { extractValueFromJson } from '../lib/jsonUtils.js'; // Still needed for conversation_id
import { getWebhookById } from '../services/webhookDefinitionService.js';
import { processResolvedWebhook } from '../services/webhookProcessorService.js';

interface IncomingWebhookParams {
    webhookProviderId: string;
    subscribedEventId: string;
    clientUserId: string;
}

interface IncomingWebhookQuery {
    secret: string;
}

// This assumes your Express router is set up to handle a route like:
// POST /incoming/:webhookProviderId/:subscribedEventId/:clientUserId
// And that this controller is the handler for it.
export const incomingWebhookController = async (req: Request<IncomingWebhookParams, {}, any, IncomingWebhookQuery>, res: Response<ServiceResponse<string>>, next: NextFunction) => {
    try {
        const { webhookProviderId, subscribedEventId, clientUserId } = req.params;
        const { secret } = req.query;
        const payload = req.body;

        // Basic validation of inputs
        if (!webhookProviderId || !subscribedEventId || !clientUserId || !secret) {
            return res.status(400).json({
                success: false,
                error: 'Bad Request',
                details: "Missing required parameters in URL path (webhookProviderId, subscribedEventId, clientUserId) or query (secret).",
                hint: "Ensure the webhook URL is in the format /incoming/:webhookProviderId/:subscribedEventId/:clientUserId?secret=YOUR_SECRET"
            });
        }

        if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Bad Request',
                details: "Request body is missing, not an object, or is empty. A JSON payload is expected.",
                hint: "Ensure the webhook event sends a valid JSON payload in the request body."
            });
        }

        console.log(`Incoming webhook: Provider=${webhookProviderId}, Event=${subscribedEventId}, ClientUser=${clientUserId}`);
        // console.log(`Payload:`, JSON.stringify(payload, null, 2)); // Be cautious logging full payloads in production

        // 1. Find and validate the UserWebhook link and its definition using the secret
        const findUserWebhookResult : UserWebhook | null = await findUserWebhookBySecret(secret);

        if (!findUserWebhookResult) {
            console.warn(`Webhook resolution failed: No active UserWebhook found for Provider=${webhookProviderId}, Event=${subscribedEventId}, ClientUser=${clientUserId} with the provided secret.`);
            return res.status(401).json({ // 401 Unauthorized, as the secret/combination is invalid
                success: false,
                error: 'Unauthorized',
                details: "Webhook event could not be authenticated or matched to an active user link. The secret may be invalid or the link inactive/misconfigured.",
                hint: "Verify the webhook secret and ensure the user's webhook link is active and correctly configured for this provider and event."
            });
        }

        // 2. Get the webhook definition
        const userWebhook = findUserWebhookResult;
        const webhook : Webhook | null = await getWebhookById(userWebhook.webhookId);
        if (!webhook) {
            console.warn(`Webhook resolution failed: No webhook definition found for UserWebhook: ${userWebhook.webhookId}`);
            return res.status(500).json({
                success: false,
                error: 'Internal Server Error',
                details: `No webhook definition found for UserWebhook: ${userWebhook.webhookId}`,
                hint: "Contact customer service to report this issue."
            });
        }
        if (webhook.webhookProviderId !== webhookProviderId || webhook.subscribedEventId !== subscribedEventId) {
            console.warn(`Webhook resolution failed: Webhook definition mismatch for UserWebhook: ${userWebhook.webhookId}`);
            return res.status(400).json({
                success: false,
                error: 'Bad Request',
                details: `Webhook URL parameters (Provider, Event) do not match the webhook definition for UserWebhook: ${userWebhook.webhookId}`,
                hint: "Request the user to update the webhook URL in the webhook provider portal."
            });
        }
        
        // 3. Find the linked agent for this user and webhook
        const agentLink: AgentUserWebhook | null = await findAgentLink(userWebhook.webhookId, userWebhook.clientUserId);

        if (!agentLink) {
            console.warn(`No agent link found for UserWebhook: ${userWebhook.webhookId}, ClientUser: ${userWebhook.clientUserId}`);
            return res.status(404).json({
                success: false,
                error: 'Not Found',
                details: `An active user webhook link was found, but no AI agent is configured to handle events for this user (Client ID: ${userWebhook.clientUserId}) and webhook definition (ID: ${userWebhook.webhookId}).`,
                hint: "Link an AI agent to this webhook"
            });
        }

        // 4. Extract conversationId if mapping exists
        let conversationIdString: string | null = null;
        const extractedConvId = extractValueFromJson(payload, webhook.conversationIdIdentificationMapping);
        if (extractedConvId !== null && extractedConvId !== undefined) {
            conversationIdString = String(extractedConvId);
        }
        
        if (!conversationIdString) {
            console.warn(`conversationId could not be extracted for webhook ID: ${webhook.id} using mapping '${webhook.conversationIdIdentificationMapping}'. This is a required field for resolution.`);
            return res.status(400).json({
                success: false,
                error: 'Bad Request',
                details: `Could not extract 'conversationId' from the webhook payload using the defined mapping '${webhook.conversationIdIdentificationMapping}'.Payload: ${JSON.stringify(payload)}`,
                hint: "Update the webhook definition's conversation ID mapping, it doesn't match any field in the payload."
            });
        }

        const processingParams = {
            platformUserId: { platformUserId: userWebhook.platformUserId }, // Construct PlatformUserId object
            clientUserId: userWebhook.clientUserId,   // Get from the validated userWebhook link
            agentId: agentLink.agentId,             // Get from the validated agent link
            conversationId: conversationIdString, // Use the extracted string
            webhookProviderId: webhook.webhookProviderId, // Use validated provider ID
            subscribedEventId: webhook.subscribedEventId, // Use validated event ID
            payload: payload,                     // The request body
            webhookId: webhook.id,                // Get ID from the webhook definition
            webhookSecret: secret                 // The secret from the query param
        };

        // Trigger the background processing (fire and forget - no await)
        processResolvedWebhook(processingParams);

        console.log(`Webhook resolved successfully for ${webhookProviderId}/${subscribedEventId}. Async processing triggered.`);
        res.status(200).json({
            success: true,
            data: "Webhook resolved successfully" // Keep response simple and fast
        });

    } catch (error) {
        console.error('[Controller Error] Resolve Webhook:', error);
        // Avoid sending detailed internal errors to the client unless necessary for debugging specific issues
        res.status(500).json({
            success: false,
            error: "Internal Server Error",
            details: "An unexpected error occurred while processing the webhook event: " + error, // Generic message
            hint: "Contact customer service to report this issue."
        });
    }
}; 