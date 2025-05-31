/**
 * Agent-Webhook Link Service Layer
 *
 * Contains business logic and data access functions related to
 * linking agents to user-webhooks (webhook_agent_links table).
 */
import { query } from '../lib/db.js';
import { WebhookAgentLinkRecord } from '../types/db.js';
import { AgentUserWebhook } from '@agent-base/types';

/**
 * Links an agent to an existing user-webhook configuration.
 * Assumes the user-webhook link already exists and is ideally active.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param platformUserId The ID of the platform user (required for the table).
 * @param agentId The ID of the agent.
 * @returns The newly created or existing WebhookAgentLinkRecord.
 */
export const linkAgentToWebhook = async (
    webhookId: string,
    clientUserId: string,
    clientOrganizationId: string,
    platformUserId: string,
    agentId: string
): Promise<AgentUserWebhook> => {
    // Include platform_user_id in the INSERT statement
    const sql = `
        INSERT INTO webhook_agent_links (webhook_id, client_user_id, client_organization_id, platform_user_id, agent_id, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (webhook_id, client_user_id, client_organization_id, agent_id) DO NOTHING
        RETURNING *;
    `;
    try {
        // Pass all four arguments to the query
        const result = await query<WebhookAgentLinkRecord>(sql, [webhookId, clientUserId, clientOrganizationId, platformUserId, agentId]);
         if (result.rows.length === 0) {
             // If ON CONFLICT DO NOTHING and it conflicted, re-fetch the existing record.
             // findWebhookAgentLink should also be updated if platformUserId becomes part of the key, but currently it isn't.
             const existing = await findWebhookAgentLink(webhookId, clientUserId, clientOrganizationId, agentId);
             if (!existing) throw new Error("Failed to create or find agent link after conflict.");
             return existing;
        }
        return mapWebhookAgentLinkRecordToWebhookAgentLink(result.rows[0]);
    } catch (err) {
        console.error("Error linking agent to webhook:", err);
        throw new Error(`Database error linking agent: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Finds an existing webhook-agent link.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param agentId The ID of the agent.
 * @returns The WebhookAgentLinkRecord or null if not found.
 */
export const findWebhookAgentLink = async (webhookId: string, clientUserId: string, clientOrganizationId: string, agentId: string): Promise<AgentUserWebhook | null> => {
    const sql = "SELECT * FROM webhook_agent_links WHERE webhook_id = $1 AND client_user_id = $2 AND client_organization_id = $3 AND agent_id = $4";
    try {
        const result = await query<WebhookAgentLinkRecord>(sql, [webhookId, clientUserId, clientOrganizationId, agentId]);
        return result.rows.length > 0 ? mapWebhookAgentLinkRecordToWebhookAgentLink(result.rows[0]) : null;
    } catch (err) {
        console.error("Error finding webhook agent link:", err);
        throw new Error(`Database error finding agent link: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Finds an existing agent-webhook link.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param clientOrganizationId The ID of the client organization.
 * @param platformUserId The ID of the platform user.
 * @returns The WebhookAgentLinkRecord or null if not found.
 */
export const findAgentLink = async (
    webhookId: string, 
    clientUserId: string, 
    clientOrganizationId: string,
): Promise<AgentUserWebhook | null> => {
    const sql = `
        SELECT * 
        FROM webhook_agent_links 
        WHERE webhook_id = $1 AND client_user_id = $2 AND client_organization_id = $3
        LIMIT 1;
    `;
    try {
        const result = await query<WebhookAgentLinkRecord>(sql, [webhookId, clientUserId, clientOrganizationId]);
        return result.rows.length > 0 ? mapWebhookAgentLinkRecordToWebhookAgentLink(result.rows[0]) : null;
    } catch (err) {
        console.error("Error finding agent webhook link:", err);
        throw new Error(`Database error finding agent webhook link: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Helper to convert DB record to application-level WebhookAgentLink type.
 */
export const mapWebhookAgentLinkRecordToWebhookAgentLink = (
    record: WebhookAgentLinkRecord
): AgentUserWebhook => {
    return {
        webhookId: record.webhook_id,
        clientUserId: record.client_user_id,
        clientOrganizationId: record.client_organization_id,
        platformUserId: record.platform_user_id,
        agentId: record.agent_id,
    };
}; 