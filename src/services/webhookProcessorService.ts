/**
 * Service: Webhook Processor
 * Handles the asynchronous tasks required after a webhook event has been successfully
 * received, validated, and resolved to specific user, agent, and conversation identifiers.
 * This includes fetching API keys, managing conversations, and triggering agent runs.
 */
import { 
    getOrCreateConversationClientUserApiService,
    triggerAgentRunClientUserApiService } from '@agent-base/api-client';
import {
    WebhookProviderId,
    WebhookEventPayload,
    CreateConversationInput,
    ServiceResponse,
    ConversationId,
    MinimalInternalCredentials,
    sanitizeConversationId
} from '@agent-base/types';
import { Message } from 'ai'; // Vercel AI SDK Message type
import { randomUUID } from 'crypto'; // Use built-in crypto module for UUIDs

// Import the database query utility
import { query } from '../lib/db.js';
// Import the type for the new table if it exists, otherwise define inline for now
// Assuming a type WebhookEventRecord might exist in ../types/db.js
// import { WebhookEventRecord } from '../types/db.js';

/**
 * Interface defining the parameters required for logging a webhook event.
 */
interface LogWebhookEventParams {
    payload: WebhookEventPayload;
    providerId: WebhookProviderId;
    subscribedEventId: string;
    clientUserId: string;
    clientOrganizationId: string;
    webhookSecret: string;
    conversationId: string;
    webhookId: string;
    agentId: string;
    platformUserId: string; // Changed type to string
}

/**
 * Logs an incoming webhook event to the webhook_events table.
 * Handles its own errors by logging them.
 * @param params - Data required for the event log record.
 */
const _logWebhookEvent = async (params: LogWebhookEventParams): Promise<void> => {
    const { 
        payload, providerId, subscribedEventId, clientUserId, clientOrganizationId,
        webhookSecret, conversationId, webhookId, agentId, 
        platformUserId // Now expects a string
    } = params;

    try {
        const insertSql = `
            INSERT INTO webhook_events (
                id, payload, provider_id, subscribed_event_id, client_user_id, client_organization_id,
                webhook_secret, conversation_id, webhook_id, agent_id, platform_user_id,
                created_at, updated_at
            )
            VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            RETURNING id; -- Return the ID of the inserted event
        `;
        // Note: Storing webhook_secret directly is a security risk.
        const result = await query<{ id: string }>(insertSql, [
            JSON.stringify(payload), // Ensure payload is stored as JSON string/jsonb
            providerId,
            subscribedEventId,
            clientUserId,
            clientOrganizationId,
            webhookSecret, // Storing the actual secret!
            conversationId,
            webhookId,
            agentId,
            platformUserId // Now correctly passing the string to the query
        ]);
        
        if (result.rows.length > 0) {
            console.log(`[Webhook Event Logger] Logged event to webhook_events with ID: ${result.rows[0].id}`);
        } else {
             console.warn(`[Webhook Event Logger] Failed to log event to webhook_events for webhook ${webhookId}. INSERT query returned no rows.`);
        }

    } catch(dbError) {
        console.error(`[Webhook Event Logger] Failed to insert event into webhook_events for webhook ${webhookId}:`, dbError);
        // Log error internally, don't re-throw to avoid halting main processing if logging fails
    }
}

/**
 * Interface defining the parameters required for asynchronous webhook processing.
 */
interface ProcessWebhookParams {
    platformUserId: string;
    clientUserId: string; // Use string for clientUserId
    clientOrganizationId: string;
    agentId: string;
    conversationId: string;
    webhookProviderId: WebhookProviderId;
    subscribedEventId: string;
    payload: WebhookEventPayload;
    webhookId: string; // Added: ID of the specific webhook definition
    webhookSecret: string; // Added: Secret used for validation (Caution: Security concern)
}

/**
 * Processes a resolved webhook event asynchronously.
 * Fetches necessary credentials, ensures a conversation exists, and triggers the agent run.
 * This function is designed to be called *after* the initial webhook request has been acknowledged (e.g., with a 202 Accepted response).
 * It intentionally does not return anything and handles its own errors internally by logging them.
 *
 * @param params - An object containing all necessary identifiers and the payload.
 */
export const processResolvedWebhook = async (params: ProcessWebhookParams): Promise<void> => {
    const {
        platformUserId,
        clientUserId,
        clientOrganizationId,
        agentId,
        conversationId,
        webhookProviderId, 
        subscribedEventId,
        payload,
        webhookId,
        webhookSecret
    } = params;

    // Sanitize the conversation ID received from params
    const originalConversationId = conversationId;
    const sanitizedConversationId = sanitizeConversationId(originalConversationId);

    console.log(`[Webhook Processor] Starting async processing for ${webhookProviderId}/${subscribedEventId}, User: ${platformUserId}, Agent: ${agentId}`);
    console.log(`[Webhook Processor] Original Conversation ID: '${originalConversationId}', Sanitized Conversation ID: '${sanitizedConversationId}'`);

    // --- Log the incoming event to the database ---    
    await _logWebhookEvent({
        payload,
        providerId: webhookProviderId,
        subscribedEventId,
        clientUserId,
        clientOrganizationId,
        webhookSecret,
        conversationId: sanitizedConversationId,
        webhookId, 
        agentId,
        platformUserId
    });

    try {
        // --- 1. Get or Create Platform API Key ---

        const platformApiKey = process.env.AGENT_BASE_API_KEY;
        if (!platformApiKey) {
          throw new Error(
            "AGENT_BASE_API_KEY environment variable is not set. Cannot construct target URL.",
          );
        }
        // --- 2. Prepare Internal Credentials ---

        const internalCredentials: MinimalInternalCredentials = {
            platformApiKey,
            clientUserId,
            clientOrganizationId
        };

        // --- 3. Get or Create Conversation ---

        const conversationInput: CreateConversationInput = {
            agentId,
            channelId: webhookProviderId,
            conversationId: sanitizedConversationId
        };

        console.debug(`[Webhook Processor] Getting or creating conversation for Agent ${agentId}, Sanitized Conversation ID ${sanitizedConversationId}`);
        console.debug(`[Webhook Processor] Internal Credentials: ${JSON.stringify(internalCredentials)}`);
        console.debug(`[Webhook Processor] Conversation Input: ${JSON.stringify(conversationInput)}`);
        const getOrCreateConversationResponse : ServiceResponse<ConversationId> = await getOrCreateConversationClientUserApiService(
            conversationInput,
            internalCredentials
        );

        if (!getOrCreateConversationResponse.success) {
            console.error(`[Webhook Processor] Failed to get/create conversation for Agent ${agentId}, Sanitized Conversation ID ${sanitizedConversationId}:`, getOrCreateConversationResponse.error);
            // Stop processing if conversation cannot be established
            return;
        }

        // --- 4. Prepare and Trigger Agent Run ---
        // Construct a user message containing the webhook payload details.
        const messageContent = `
        This is an automated message from ${webhookProviderId}/${subscribedEventId}.
        You received this webhook event with the following payload:
        ${JSON.stringify(payload, null, 2)}
        If you need more context about the event (like an incoming WhatsApp without history),
        you may want to retrieve past tool calls and past webhook events to get the relevant context.
        `;

        const webhookMessage: Message = {
            id: randomUUID(), // Generate a unique ID for this message using crypto.randomUUID
            role: 'user', // Webhook event triggers a 'user' message for the agent
            content: messageContent,
            createdAt: new Date(),
        };

        const runResponse = await triggerAgentRunClientUserApiService(
            sanitizedConversationId,
            webhookMessage,
            internalCredentials
        );

        if (!runResponse.success) {
            console.error(`[Webhook Processor] Failed to trigger agent run for Agent ${agentId}, Sanitized Conversation ID ${sanitizedConversationId}:`, runResponse.error);
            // Error logged, processing stops here for this event
        }

    } catch (error: unknown) {
        // Catch any unexpected errors during the asynchronous processing
        console.error(`[Webhook Processor] Unhandled error during async processing for ${webhookProviderId}/${subscribedEventId}, User: ${platformUserId}, Sanitized Conversation ID: ${sanitizedConversationId}:`, error);
        // Log the error, but can't send a response back to the original caller.
    }
};

// Potentially add other related functions here if needed 