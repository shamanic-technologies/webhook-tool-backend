/**
 * User-Webhook Link Service Layer
 *
 * Contains business logic and data access functions related to
 * linking users to webhooks (user_webhooks table).
 */
import { query } from '../lib/db.js';
import { UserWebhookRecord, WebhookRecord } from '../types/db.js';
import { WebhookStatus, UserWebhook } from '@agent-base/types';

/**
 * Finds an existing user-webhook link.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @returns The UserWebhookRecord or null if not found.
 */
export const findUserWebhook = async (webhookId: string, clientUserId: string): Promise<UserWebhook | null> => {
    const sql = "SELECT * FROM user_webhooks WHERE webhook_id = $1 AND client_user_id = $2";
    try {
        const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserId]);
        return result.rows.length > 0 ? mapUserWebhookRecordToUserWebhook(result.rows[0]) : null;
    } catch (err) {
        console.error("Error finding user webhook link:", err);
        throw new Error(`Database error finding user webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Creates a new link between a user and a webhook or updates existing.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param platformUserId The ID of the platform user.
 * @param status The initial status of the link (e.g., PENDING).
 * @param clientUserIdentificationHash The hash of identifying fields (null if status is not ACTIVE).
 * @returns The newly created or updated UserWebhookRecord.
 */
export const createUserWebhook = async (
    webhookId: string, 
    clientUserId: string, 
    platformUserId: string,
    status: WebhookStatus, 
    clientUserIdentificationHash: string | null
): Promise<UserWebhook> => {
    // The primary key constraint name defined in the migration is 'user_webhooks_pkey'
    const constraintName = 'user_webhooks_pkey'; 
    const sql = `
        INSERT INTO user_webhooks (
            webhook_id, 
            client_user_id, 
            platform_user_id,
            status, 
            client_user_identification_hash,
            created_at, 
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        -- Specify the constraint name for ON CONFLICT
        ON CONFLICT ON CONSTRAINT ${constraintName} 
        DO UPDATE SET 
            platform_user_id = EXCLUDED.platform_user_id, 
            status = EXCLUDED.status, 
            client_user_identification_hash = EXCLUDED.client_user_identification_hash,
            updated_at = NOW()
        RETURNING *;
    `;
    try {
        const result = await query<UserWebhookRecord>(sql, [
            webhookId, 
            clientUserId, 
            platformUserId,
            status, 
            clientUserIdentificationHash
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
 * Updates the status and identification hash of an existing user-webhook link.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param status The new status.
 * @param clientUserIdentificationHash The new hash value (can be null).
 * @returns The updated UserWebhookRecord.
 * @throws Error if the record doesn't exist or update fails.
 */
export const updateUserWebhookStatus = async (
    webhookId: string, 
    clientUserId: string, 
    status: WebhookStatus, 
    clientUserIdentificationHash: string | null
): Promise<UserWebhook> => {
    const sql = `
        UPDATE user_webhooks
        SET 
            status = $3, 
            client_user_identification_hash = $4,
            updated_at = NOW()
        WHERE webhook_id = $1 AND client_user_id = $2
        RETURNING *;
    `;
    try {
        const result = await query<UserWebhookRecord>(sql, [
            webhookId, 
            clientUserId, 
            status, 
            clientUserIdentificationHash
        ]);
        if (result.rows.length === 0) {
            throw new Error("User webhook link not found for status update.");
        }
        return mapUserWebhookRecordToUserWebhook(result.rows[0]);
    } catch (err) {
        console.error("Error updating user webhook status/hash:", err);
        throw new Error(`Database error updating user webhook status/hash: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Helper to convert DB record to application-level UserWebhook type.
 */
export const mapUserWebhookRecordToUserWebhook = (record: UserWebhookRecord): UserWebhook => {
    if (record.client_user_identification_hash === null) {
        throw new Error(`Database integrity error: client_user_identification_hash is null for record webhookId=${record.webhook_id}, clientUserId=${record.client_user_id}. This should not happen for ACTIVE webhooks returned to the application.`);
    }
    return {
        webhookId: record.webhook_id,
        clientUserId: record.client_user_id,
        platformUserId: record.platform_user_id,
        status: record.status,
        clientUserIdentificationHash: record.client_user_identification_hash,
        createdAt: record.created_at,
    };
};

// Function to find user webhook by hash (needed for resolver)
import { computeIdentifierHash } from '../lib/crypto.js'; // Ensure crypto is imported if not already

/**
 * Finds a UserWebhook record by webhookId and the hash of its identifiers.
 * @param webhookId The ID of the webhook definition.
 * @param providerIdentifierHash The computed HMAC hash of the identifiers.
 * @returns The found UserWebhookRecord or null.
 */
export async function findUserWebhookByIdentifierHash(
    webhookId: string,
    clientUserIdentificationHash: string // Renamed param for clarity
): Promise<UserWebhook | null> {
     const sql = `
        SELECT * 
        FROM user_webhooks 
        WHERE webhook_id = $1 AND client_user_identification_hash = $2
     `;
     try {
         const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserIdentificationHash]);
         return result.rows.length > 0 ? mapUserWebhookRecordToUserWebhook(result.rows[0]) : null;
     } catch (err) {
         console.error("Error finding user webhook link by hash:", err);
         throw new Error(`Database error finding user webhook by hash: ${err instanceof Error ? err.message : String(err)}`);
     }
} 
