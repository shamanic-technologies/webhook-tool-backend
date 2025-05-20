/**
 * Service for retrieving webhook events associated with a specific webhook and client user.
 */
import { 
    ServiceResponse,
    ErrorResponse,
    WebhookEvent,
    UtilityProvider
} from '@agent-base/types';
import { query } from '../lib/db.js'; // Import the database query helper
import { WebhookEventRecord } from '../types/db.js'; // Import the DB record type


/**
 * Fetches webhook events for a given webhookId and clientUserId.
 * 
 * @param {string} webhookId - The ID of the webhook.
 * @param {string} clientUserId - The ID of the client user making the request.
 * @returns {Promise<ServiceResponse<WebhookEvent[]>>} - A promise resolving to a service response containing the list of events or an error.
 */
export const getWebhookEventsService = async (
    webhookId: string, 
    clientUserId: string
): Promise<ServiceResponse<WebhookEvent[]>> => {
    console.log(`Service: Fetching events for webhookId: ${webhookId}, clientUserId: ${clientUserId}`);

    const sql = `
        SELECT * 
        FROM webhook_events 
        WHERE webhook_id = $1 AND client_user_id = $2
        ORDER BY created_at DESC; -- Order by most recent first
    `;

    try {
        // Execute the query using the db helper
        const result = await query<WebhookEventRecord>(sql, [webhookId, clientUserId]);
        
        // Map the database records to the API response type
        const events: WebhookEvent[] = result.rows.map(mapWebhookEventRecordToWebhookEvent);
        
        console.log(`Service: Found ${events.length} events for webhookId: ${webhookId}`);

        const response: ServiceResponse<WebhookEvent[]> = {
            success: true,
            data: events,
        };
        return response;

    } catch (error) {
        console.error(`Error in getWebhookEventsService for webhookId ${webhookId}, clientUserId ${clientUserId}:`, error);
        const errorResponse: ErrorResponse = {
            success: false,
            error: 'Service Error',
            details: error instanceof Error ? error.message : 'An unknown database error occurred while fetching webhook events.',
            hint: 'There was an issue retrieving the webhook events from the database.'
        };
        return errorResponse; 
    }
}; 



/**
 * Maps a database WebhookEventRecord (snake_case) to the application/API WebhookEvent type (camelCase).
 * @param {WebhookEventRecord} record - The database record.
 * @returns {WebhookEvent} - The mapped application-level event object.
 */
const mapWebhookEventRecordToWebhookEvent = (record: WebhookEventRecord): WebhookEvent => {
    // Basic validation or default for payload
    let parsedPayload: Record<string, any> = {};
    if (record.payload && typeof record.payload === 'object') {
         parsedPayload = record.payload;
    } else if (typeof record.payload === 'string') {
        try {
            parsedPayload = JSON.parse(record.payload);
        } catch (e) {
            console.error(`Failed to parse payload for event ID ${record.id}:`, e);
            // Keep payload empty or handle error as needed
        }
    }

    return {
        eventId: record.id, // Map id to eventId
        webhookId: record.webhook_id,
        clientUserId: record.client_user_id,
        platformUserId: record.platform_user_id,
        createdAt: record.created_at, // Assuming created_at represents received time
        updatedAt: record.updated_at, // Or map based on a specific status/timestamp if available
        payload: parsedPayload, 
        providerId: record.provider_id as UtilityProvider,
        subscribedEventId: record.subscribed_event_id,
        conversationId: record.conversation_id as string,
        agentId: record.agent_id as string,
        webhookSecret: record.webhook_secret,
    };
};
