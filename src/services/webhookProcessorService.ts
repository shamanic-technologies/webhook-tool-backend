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
        payload
    } = params;

    console.log(`[Webhook Processor] Starting async processing for ${webhookProviderId}/${subscribedEventId}, User: ${platformUserId}, Agent: ${agentId}, Conversation: ${conversationId}`);

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