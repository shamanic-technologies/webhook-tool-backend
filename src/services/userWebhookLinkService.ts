/**
 * User-Webhook Link Service Layer
 *
 * Contains business logic and data access functions related to
 * linking users to webhooks (user_webhooks table).
 */
import { query } from '../lib/db.js';
import { UserWebhookRecord, WebhookRecord } from '../types/db.js';
import { WebhookStatus, UserWebhook, UtilitySecretType, WebhookProviderId, Webhook } from '@agent-base/types';
import { randomUUID } from 'crypto'; // Added for generating webhook_secret

/**
 * Finds an existing user-webhook link.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param clientOrganizationId The ID of the client organization.
 * @returns The UserWebhookRecord or null if not found.
 */
export const findUserWebhook = async (webhookId: string, clientUserId: string, clientOrganizationId: string): Promise<UserWebhook | null> => {
    const sql = "SELECT * FROM user_webhooks WHERE webhook_id = $1 AND client_user_id = $2 AND client_organization_id = $3";
    try {
        const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserId, clientOrganizationId]);
        return result.rows.length > 0 ? mapUserWebhookRecordToUserWebhook(result.rows[0]) : null;
    } catch (err) {
        console.error("Error finding user webhook link:", err);
        throw new Error(`Database error finding user webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Creates a new link between a user and a webhook or updates existing if a conflict occurs on primary key.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param platformUserId The ID of the platform user.
 * @param status The initial status of the link (e.g., PENDING).
 * @returns The newly created or updated UserWebhook.
 */
export const createUserWebhook = async (
    webhookId: string, 
    clientUserId: string, 
    clientOrganizationId: string,
    platformUserId: string,
    status: WebhookStatus,
): Promise<UserWebhook> => {
    const newWebhookSecret = randomUUID();
    const constraintName = 'user_webhooks_pkey'; 
    const sql = `
        INSERT INTO user_webhooks (
            webhook_id, 
            client_user_id, 
            client_organization_id,
            platform_user_id,
            status, 
            webhook_secret, -- Added webhook_secret
            created_at, 
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT ON CONSTRAINT ${constraintName} 
        DO UPDATE SET 
            platform_user_id = EXCLUDED.platform_user_id, 
            status = EXCLUDED.status, 
            webhook_secret = EXCLUDED.webhook_secret, -- Ensure webhook_secret is updated on conflict if necessary
            updated_at = NOW()
        RETURNING *;
    `;
    try {
        const result = await query<UserWebhookRecord>(sql, [
            webhookId, 
            clientUserId, 
            clientOrganizationId,
            platformUserId,
            status, 
            newWebhookSecret // Pass the generated secret
        ]);
        if (result.rows.length === 0) { 
             throw new Error("Failed to create or update user webhook link (conflict resolution failed?).");
        }
        return mapUserWebhookRecordToUserWebhook(result.rows[0]);
    } catch (err) {
        console.error("Error creating/updating user webhook link:", err);
        throw new Error(`Database error creating/updating user webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Updates the status of an existing user-webhook link.
 * The webhook_secret is NOT updated by this function; it is set at creation.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param clientOrganizationId The ID of the client organization.
 * @param status The new status.
 * @returns The updated UserWebhook (including the existing webhook_secret).
 * @throws Error if the record doesn't exist or update fails.
 */
export const updateUserWebhookStatus = async (
    webhookId: string, 
    clientUserId: string, 
    clientOrganizationId: string,
    status: WebhookStatus 
): Promise<UserWebhook> => {
    const sql = `
        UPDATE user_webhooks
        SET 
            status = $4,
            -- webhook_secret is NOT modified here
            -- client_user_identification_hash is NOT modified here and is deprecated
            updated_at = NOW()
        WHERE webhook_id = $1 AND client_user_id = $2 AND client_organization_id = $3
        RETURNING *;
    `;
    try {
        const result = await query<UserWebhookRecord>(sql, [
            webhookId, 
            clientUserId, 
            clientOrganizationId,
            status 
        ]);
        if (result.rows.length === 0) {
            throw new Error("User webhook link not found for status update.");
        }
        return mapUserWebhookRecordToUserWebhook(result.rows[0]);
    } catch (err) {
        console.error("Error updating user webhook status:", err);
        throw new Error(`Database error updating user webhook status: ${err instanceof Error ? err.message : String(err)}`);
    }
};

// // Get UserWebhook by webhookId and clientUserId
// export const getUserWebhookByWebhookIdAndClientUserId = async (webhookId: string, clientUserId: string): Promise<UserWebhook> => {
//     const sql = "SELECT * FROM user_webhooks WHERE webhook_id = $1 AND client_user_id = $2";
//     const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserId]);
//     if (result.rows.length === 0) {
//         throw new Error(`User webhook link not found for webhookId ${webhookId} and clientUserId ${clientUserId}`);
//     }
//     return mapUserWebhookRecordToUserWebhook(result.rows[0]);
// };

/**
 * Helper to convert DB record to application-level UserWebhook type.
 */
export const mapUserWebhookRecordToUserWebhook = (record: UserWebhookRecord): UserWebhook => {
    return {
        webhookId: record.webhook_id,
        clientUserId: record.client_user_id,
        clientOrganizationId: record.client_organization_id,
        platformUserId: record.platform_user_id,
        status: record.status,
        webhookSecret: record.webhook_secret,
        createdAt: record.created_at,
    };
};

/**
 * Finds an active UserWebhook link and its associated Webhook definition (as Webhook type)
 * by matching provider, event, client user ID, and the unique webhook secret.
 *
 * @param webhookProviderId The ID of the webhook provider.
 * @param subscribedEventId The ID of the subscribed event.
 * @param clientUserId The ID of the client user.
 * @param clientOrganizationId The ID of the client organization.
 * @param secret The unique secret from the webhook URL.
 * @returns A Promise resolving to an object containing the UserWebhook and its Webhook (application type), or null if not found or not active.
 */
export const findUserWebhookBySecret = async (
    secret: string
): Promise<UserWebhook | null> => {
    // We select all fields from both tables and will separate them in the application logic
    const sql = `
        SELECT *
        FROM user_webhooks uw
        WHERE uw.webhook_secret = $1;
    `;
    try {
        const result = await query<any>(sql, [secret]);
        if (result.rows.length === 0) {return null;}
        const record = result.rows[0];
        const userWebhook: UserWebhook = mapUserWebhookRecordToUserWebhook(record as UserWebhookRecord);
        return userWebhook;
    } catch (err) {
        console.error("Error finding active user webhook by secret with definition:", err);
        throw new Error(`Database error finding active user webhook by secret: ${err instanceof Error ? err.message : String(err)}`);
    }
};

// // Function to find user webhook by hash (needed for resolver)
// import { computeIdentifierHash } from '../lib/crypto.js'; // Ensure crypto is imported if not already

// /**
//  * Finds a UserWebhook record by webhookId and the hash of its identifiers.
//  * @param webhookId The ID of the webhook definition.
//  * @param providerIdentifierHash The computed HMAC hash of the identifiers.
//  * @returns The found UserWebhookRecord or null.
//  */
// export async function findUserWebhookByIdentifierHash(
//     webhookId: string,
//     clientUserIdentificationHash: string // Renamed param for clarity
// ): Promise<UserWebhook | null> {
//      const sql = `
//         SELECT * 
//         FROM user_webhooks 
//         WHERE webhook_id = $1 AND client_user_identification_hash = $2
//      `;
//      try {
//          const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserIdentificationHash]);
//          return result.rows.length > 0 ? mapUserWebhookRecordToUserWebhook(result.rows[0]) : null;
//      } catch (err) {
//          console.error("Error finding user webhook link by hash:", err);
//          throw new Error(`Database error finding user webhook by hash: ${err instanceof Error ? err.message : String(err)}`);
//      }
// } 
