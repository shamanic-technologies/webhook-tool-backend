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
    PlatformUserId,
    ClientUserApiServiceCredentials,
} from '@agent-base/types';
// @ts-ignore
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
    webhookSecret: string;
    conversationId: string;
    webhookId: string;
    agentId: string;
    platformUserId: PlatformUserId;
}

/**
 * Logs an incoming webhook event to the webhook_events table.
 * Handles its own errors by logging them.
 * @param params - Data required for the event log record.
 */
const _logWebhookEvent = async (params: LogWebhookEventParams): Promise<void> => {
    const { 
        payload, providerId, subscribedEventId, clientUserId, 
        webhookSecret, conversationId, webhookId, agentId, platformUserId
    } = params;

    try {
        const insertSql = `
            INSERT INTO webhook_events (
                id, payload, provider_id, subscribed_event_id, client_user_id, 
                webhook_secret, conversation_id, webhook_id, agent_id, platform_user_id,
                created_at, updated_at
            )
            VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            RETURNING id; -- Return the ID of the inserted event
        `;
        // Note: Storing webhook_secret directly is a security risk.
        const result = await query<{ id: string }>(insertSql, [
            JSON.stringify(payload), // Ensure payload is stored as JSON string/jsonb
            providerId,
            subscribedEventId,
            clientUserId,
            webhookSecret, // Storing the actual secret!
            conversationId,
            webhookId,
            agentId,
            platformUserId
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
    platformUserId: PlatformUserId;
    clientUserId: string; // Use string for clientUserId
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
        agentId,
        conversationId,
        webhookProviderId,
        subscribedEventId,
        payload,
        webhookId,      // Destructure new param
        webhookSecret   // Destructure new param
    } = params;

    console.log(`[Webhook Processor] Starting async processing for ${webhookProviderId}/${subscribedEventId}, User: ${platformUserId}, Agent: ${agentId}, Conversation: ${conversationId}`);

    // --- Log the incoming event to the database ---    
    // Call the separate logging function (awaiting is optional as it handles its own errors)
    await _logWebhookEvent({
        payload,
        providerId: webhookProviderId,
        subscribedEventId,
        clientUserId,
        webhookSecret,
        conversationId,
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

        const clientUserApiServiceCredentials: ClientUserApiServiceCredentials = {
            platformApiKey,
            clientUserId
        };

        // --- 3. Get or Create Conversation ---

        const conversationInput: CreateConversationInput = {
            agentId,
            channelId: webhookProviderId,
            conversationId
        };

        const getOrCreateConversationResponse : ServiceResponse<ConversationId> = await getOrCreateConversationClientUserApiService(
            conversationInput,
            clientUserApiServiceCredentials
        );

        if (!getOrCreateConversationResponse.success) {
            console.error(`[Webhook Processor] Failed to get/create conversation for Agent ${agentId}, Resolved Conversation ID ${conversationId}:`, getOrCreateConversationResponse.error);
            // Stop processing if conversation cannot be established
            return;
        }

        // --- 4. Prepare and Trigger Agent Run ---
        // Construct a user message containing the webhook payload details.
        const messageContent = `
        You received this webhook event from ${webhookProviderId}/${subscribedEventId} with the following payload:
        \`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`
        `;

        const webhookMessage: Message = {
            id: randomUUID(), // Generate a unique ID for this message using crypto.randomUUID
            role: 'user', // Webhook event triggers a 'user' message for the agent
            content: messageContent,
            createdAt: new Date(),
        };

        const runResponse = await triggerAgentRunClientUserApiService(
            conversationId,
            webhookMessage,
            clientUserApiServiceCredentials
        );

        if (!runResponse.success) {
            console.error(`[Webhook Processor] Failed to trigger agent run for Agent ${agentId}, Conversation ${conversationId}:`, runResponse.error);
            // Error logged, processing stops here for this event
        }

    } catch (error: unknown) {
        // Catch any unexpected errors during the asynchronous processing
        console.error(`[Webhook Processor] Unhandled error during async processing for ${webhookProviderId}/${subscribedEventId}, User: ${platformUserId}:`, error);
        // Log the error, but can't send a response back to the original caller.
    }
};

// Potentially add other related functions here if needed 