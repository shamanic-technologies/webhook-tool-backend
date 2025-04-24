/**
 * User-Webhook Link Service Layer
 *
 * Contains business logic and data access functions related to
 * linking users to webhooks (user_webhooks table).
 */
import { query } from '../lib/db.js';
import { UserWebhookRecord } from '../types/db.js';
import { WebhookStatus, UserWebhook } from '@agent-base/types';

/**
 * Finds an existing user-webhook link.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @returns The UserWebhookRecord or null if not found.
 */
export const findUserWebhook = async (webhookId: string, clientUserId: string): Promise<UserWebhookRecord | null> => {
    const sql = "SELECT * FROM user_webhooks WHERE webhook_id = $1 AND client_user_id = $2";
    try {
        const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserId]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (err) {
        console.error("Error finding user webhook link:", err);
        throw new Error(`Database error finding user webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Creates a new link between a user and a webhook.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param status The initial status of the link (e.g., PENDING).
 * @returns The newly created UserWebhookRecord.
 */
export const createUserWebhook = async (webhookId: string, clientUserId: string, status: WebhookStatus): Promise<UserWebhookRecord> => {
    const sql = `
        INSERT INTO user_webhooks (webhook_id, client_user_id, status, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (webhook_id, client_user_id) DO UPDATE 
        SET status = EXCLUDED.status, updated_at = NOW() -- Update status if conflict
        WHERE user_webhooks.status <> EXCLUDED.status -- Only update if status changed
        RETURNING *;
    `;
    try {
        const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserId, status]);
        if (result.rows.length === 0) {
             // If conflict occurred but status didn't change, fetch existing
             const existing = await findUserWebhook(webhookId, clientUserId);
             if (!existing) throw new Error("Failed to create or find user webhook link after conflict resolution.");
             return existing;
        }
        return result.rows[0];
    } catch (err) {
        console.error("Error creating user webhook link:", err);
        throw new Error(`Database error creating user webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Updates the status of an existing user-webhook link.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param status The new status.
 * @returns The updated UserWebhookRecord.
 * @throws Error if the record doesn't exist or update fails.
 */
export const updateUserWebhookStatus = async (webhookId: string, clientUserId: string, status: WebhookStatus): Promise<UserWebhookRecord> => {
    const sql = `
        UPDATE user_webhooks
        SET status = $3, updated_at = NOW()
        WHERE webhook_id = $1 AND client_user_id = $2
        RETURNING *;
    `;
    try {
        const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserId, status]);
        if (result.rows.length === 0) {
            // This case should ideally not happen if createUserWebhook handles conflicts,
            // but check just in case.
            throw new Error("User webhook link not found for status update.");
        }
        return result.rows[0];
    } catch (err) {
        console.error("Error updating user webhook status:", err);
        throw new Error(`Database error updating user webhook status: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Helper to convert DB record to application-level UserWebhook type.
 */
export const mapUserWebhookRecordToUserWebhook = (record: UserWebhookRecord): UserWebhook => {
    return {
        webhookId: record.webhook_id,
        clientUserId: record.client_user_id,
        status: record.status,
        createdAt: record.created_at,
        // Map updated_at if needed by UserWebhook type
        // updatedAt: record.updated_at 
    };
}; 