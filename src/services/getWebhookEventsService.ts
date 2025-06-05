/**
 * Service for retrieving webhook events associated with a specific webhook and client user,
 * and for retrieving the N latest events for a client user/organization.
 */
import { 
    ServiceResponse,
    ErrorResponse,
    WebhookEvent,
    WebhookProviderId // Changed from UtilityProvider for clarity, as it's used as WebhookProviderId
} from '@agent-base/types';
import { query } from '../lib/db.js'; // Import the database query helper
import { WebhookEventRecord } from '../types/db.js'; // Import the DB record type


/**
 * Fetches webhook events for a given webhookId and clientUserId.
 * 
 * @param {string} webhookId - The ID of the webhook.
 * @param {string} clientUserId - The ID of the client user making the request.
 * @param {string} clientOrganizationId - The ID of the client organization.
 * @returns {Promise<ServiceResponse<WebhookEvent[]>>} - A promise resolving to a service response containing the list of events or an error.
 */
export const getWebhookEventsService = async (
    webhookId: string, 
    clientUserId: string,
    clientOrganizationId: string
): Promise<ServiceResponse<WebhookEvent[]>> => {

    const sql = `
        SELECT * 
        FROM webhook_events 
        WHERE webhook_id = $1 AND client_user_id = $2 AND client_organization_id = $3
        ORDER BY created_at DESC; -- Order by most recent first
    `;

    try {
        // Execute the query using the db helper
        const result = await query<WebhookEventRecord>(sql, [webhookId, clientUserId, clientOrganizationId]);
        
        if (!result.rows) {
            console.warn('[Service:getWebhookEventsService] Database query returned no rows array.');
            return { success: true, data: [] };
       }

        // Map the database records to the API response type
        const events: WebhookEvent[] = result.rows.map(mapWebhookEventRecordToWebhookEvent);
        
        console.log(`[Service:getWebhookEventsService] Found ${events.length} events for webhookId: ${webhookId}`);

        const response: ServiceResponse<WebhookEvent[]> = {
            success: true,
            data: events,
        };
        return response;

    } catch (error) {
        console.error(`[Service:getWebhookEventsService] Error for webhookId ${webhookId}, clientUserId ${clientUserId}:`, error);
        
        let errorType = 'Service Error';
        let errorDetails = 'An unknown database error occurred while fetching webhook events.';
        if (error instanceof Error) {
            errorDetails = error.message;
            if (error.message.startsWith('Data Integrity Issue:')) {
                errorType = 'Data Integrity Error';
            }
        }

        const errorResponse: ErrorResponse = {
            success: false,
            error: errorType,
            details: errorDetails,
            hint: 'There was an issue retrieving the webhook events from the database.'
        };
        return errorResponse; 
    }
};

/**
 * Fetches the N latest webhook events for a given client user and organization.
 *
 * @param {string} clientUserId - The ID of the client user.
 * @param {string} clientOrganizationId - The ID of the client organization.
 * @param {number} limit - The maximum number of events to retrieve.
 * @returns {Promise<ServiceResponse<WebhookEvent[]>>} - The service response containing the list of events or an error.
 */
export const getLatestWebhookEventsForUserOrgService = async (
    clientUserId: string,
    clientOrganizationId: string,
    limit: number
): Promise<ServiceResponse<WebhookEvent[]>> => {
    try {
        // Basic input validation, though controller should also do this
        if (!clientUserId || !clientOrganizationId) {
            const errorResponse: ErrorResponse = {
                success: false,
                error: 'Bad Request',
                details: 'Client User ID and Client Organization ID are required for fetching latest events.',
                hint: 'This should not happen. Ensure IDs are provided by the caller.'
            };
            return errorResponse;
        }
        if (limit <= 0) {
            console.warn('[Service:getLatestWebhookEventsForUserOrgService] Invalid limit requested, defaulting to 1. Controller should validate.');
            limit = 1; // Safeguard
        }

        console.log(`[Service:getLatestWebhookEventsForUserOrgService] Fetching latest ${limit} events for clientUserId: ${clientUserId}, clientOrganizationId: ${clientOrganizationId}`);

        const sql = `
            SELECT *
            FROM webhook_events
            WHERE client_user_id = $1 AND client_organization_id = $2
            ORDER BY created_at DESC
            LIMIT $3;
        `;

        const result = await query<WebhookEventRecord>(sql, [clientUserId, clientOrganizationId, limit]);

        if (!result.rows) {
            console.warn('[Service:getLatestWebhookEventsForUserOrgService] Database query returned no rows array.');
            return { success: true, data: [] };
        }

        const webhookEvents: WebhookEvent[] = result.rows.map(mapWebhookEventRecordToWebhookEvent);
        
        console.log(`[Service:getLatestWebhookEventsForUserOrgService] Successfully fetched ${webhookEvents.length} latest events.`);
        return {
            success: true,
            data: webhookEvents,
        };

    } catch (error) {
        console.error(`[Service:getLatestWebhookEventsForUserOrgService] Error for user ${clientUserId}, org ${clientOrganizationId}:`, error);
        
        let errorType = 'Internal Server Error';
        let errorDetails = 'An unexpected error occurred while fetching latest webhook events.';

        if (error instanceof Error) {
            errorDetails = error.message;
            if (error.message.startsWith('Data Integrity Issue:')) {
                errorType = 'Data Integrity Error';
            }
        }

        const errorResponse: ErrorResponse = {
            success: false,
            error: errorType,
            details: errorDetails,
            hint: 'Try again later. If the issue persists, contact support.'
        };
        return errorResponse;
    }
};


/**
 * Maps a database WebhookEventRecord (snake_case) to the application/API WebhookEvent type (camelCase).
 * Includes strict checks for conversation_id and agent_id.
 * @param {WebhookEventRecord} record - The database record.
 * @returns {WebhookEvent} - The mapped application-level event object.
 * @throws {Error} if critical fields (conversation_id, agent_id) are missing.
 */
const mapWebhookEventRecordToWebhookEvent = (record: WebhookEventRecord): WebhookEvent => {
    // Critical checks for fields required by the WebhookEvent type but potentially nullable in DB
    if (record.conversation_id === null || record.conversation_id === undefined) {
        throw new Error(`Data Integrity Issue: WebhookEventRecord with id ${record.id} is missing conversation_id.`);
    }
    if (record.agent_id === null || record.agent_id === undefined) {
        throw new Error(`Data Integrity Issue: WebhookEventRecord with id ${record.id} is missing agent_id.`);
    }

    let parsedPayload: Record<string, any> = {};
    if (record.payload && typeof record.payload === 'object') {
         parsedPayload = record.payload;
    } else if (typeof record.payload === 'string') {
        try {
            parsedPayload = JSON.parse(record.payload);
        } catch (e) {
            console.error(`[ServiceMapper] Failed to parse JSON payload for event ID ${record.id}. Payload: ${record.payload}. Error:`, e);
            // Keep payload empty or decide on a stricter error handling if payload string must be valid JSON
        }
    }

    return {
        eventId: record.id, 
        webhookId: record.webhook_id,
        clientUserId: record.client_user_id,
        clientOrganizationId: record.client_organization_id,
        platformUserId: record.platform_user_id,
        payload: parsedPayload, 
        providerId: record.provider_id as WebhookProviderId, // Ensure this casting is safe or add validation
        subscribedEventId: record.subscribed_event_id,
        webhookSecret: record.webhook_secret,
        conversationId: record.conversation_id, // Now guaranteed string due to checks above
        agentId: record.agent_id, // Now guaranteed string due to checks above
        createdAt: record.created_at,
        updatedAt: record.updated_at,
    };
};
