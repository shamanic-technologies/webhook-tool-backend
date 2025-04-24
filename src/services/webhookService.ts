/**
 * Webhook Service Layer
 *
 * Contains business logic and data access functions related to webhooks,
 * user links, and agent links.
 */
import { query } from '../lib/db.js';
import { 
    WebhookRecord, 
    UserWebhookRecord, 
    WebhookAgentLinkRecord 
} from '../types/db.js';
import { 
    WebhookData, 
    Webhook, 
    WebhookStatus, 
    UserWebhook, 
    WebhookAgentLink, 
    UtilitySecretType,
    WebhookProviderId
} from '@agent-base/types';
import pgvector from 'pgvector/pg'; // Import for vector type usage
import { v4 as uuidv4 } from 'uuid'; // For generating webhook IDs

/**
 * Creates a new webhook definition in the database.
 *
 * @param webhookData Data for the new webhook.
 * @param embedding Optional vector embedding for the webhook.
 * @returns The newly created WebhookRecord.
 * @throws Error if database insertion fails.
 */
export const createWebhook = async (webhookData: WebhookData, embedding?: number[]): Promise<WebhookRecord> => {
  const newId = uuidv4();
  const { 
    name, 
    description, 
    webhookProviderId, 
    subscribedEventId, 
    requiredSecrets, 
    userIdentificationMapping, 
    eventPayloadSchema 
  } = webhookData;

  // Convert arrays/objects to JSON strings for PG
  const requiredSecretsJson = JSON.stringify(requiredSecrets);
  const userIdentificationMappingJson = JSON.stringify(userIdentificationMapping);
  const eventPayloadSchemaJson = JSON.stringify(eventPayloadSchema);
  const embeddingSql = embedding ? pgvector.toSql(embedding) : null;

  const sql = `
    INSERT INTO webhooks (id, name, description, webhook_provider_id, subscribed_event_id, required_secrets, user_identification_mapping, event_payload_schema, embedding, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    RETURNING *;
  `;

  try {
    const result = await query<WebhookRecord>(sql, [
      newId, name, description, webhookProviderId, subscribedEventId,
      requiredSecretsJson, userIdentificationMappingJson, eventPayloadSchemaJson, embeddingSql
    ]);
    if (result.rows.length === 0) {
      throw new Error("Webhook creation failed, no record returned.");
    }
    // Convert JSON strings back to objects/arrays if needed for the return type,
    // although the DB driver might handle this for RETURNING *. Check driver behavior.
    // If not, manual parsing is needed here.
    return result.rows[0];
  } catch (err) {
    console.error("Error creating webhook:", err);
    throw new Error(`Database error during webhook creation: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Retrieves a webhook definition by its ID.
 *
 * @param id The UUID of the webhook.
 * @returns The WebhookRecord or null if not found.
 * @throws Error if database query fails.
 */
export const getWebhookById = async (id: string): Promise<WebhookRecord | null> => {
  const sql = "SELECT * FROM webhooks WHERE id = $1";
  try {
    const result = await query<WebhookRecord>(sql, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    // TODO: Parse JSON fields (required_secrets, etc.) if driver doesn't auto-parse
    return result.rows[0];
  } catch (err) {
    console.error("Error retrieving webhook by ID:", err);
    throw new Error(`Database error retrieving webhook: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Searches for webhooks based on a query vector (cosine similarity).
 * Placeholder: Needs actual embedding generation and vector column in DB.
 *
 * @param queryVector The vector representation of the search query.
 * @param limit The maximum number of results to return.
 * @returns An array of matching WebhookRecords.
 * @throws Error if database query fails.
 */
export const searchWebhooks = async (queryVector: number[], limit: number): Promise<WebhookRecord[]> => {
  // Ensure embedding column exists and has an index (e.g., USING ivfflat or hnsw)
  // Example assumes cosine distance (1 - cosine_similarity)
  const embeddingSql = pgvector.toSql(queryVector);
  const sql = `
    SELECT *, 1 - (embedding <=> $1) AS similarity
    FROM webhooks
    ORDER BY embedding <=> $1
    LIMIT $2;
  `;
  try {
    // The result type might need adjustment if similarity is included
    const result = await query<WebhookRecord & { similarity: number }>(sql, [embeddingSql, limit]);
    // TODO: Parse JSON fields
    return result.rows;
  } catch (err) {
    console.error("Error searching webhooks:", err);
    // Check for common errors like missing index or column
    if (err instanceof Error && err.message.includes('column "embedding" does not exist')) {
        console.warn('Search failed: Webhook embedding column likely missing or not populated.');
        return []; // Return empty instead of throwing? Or re-throw specific error?
    }
    throw new Error(`Database error searching webhooks: ${err instanceof Error ? err.message : String(err)}`);
  }
};

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
        ON CONFLICT (webhook_id, client_user_id) DO NOTHING -- Or DO UPDATE if needed
        RETURNING *;
    `;
    try {
        const result = await query<UserWebhookRecord>(sql, [webhookId, clientUserId, status]);
        if (result.rows.length === 0) {
             // If ON CONFLICT DO NOTHING and it conflicted, we might get 0 rows.
             // Re-fetch the existing record in this case.
             const existing = await findUserWebhook(webhookId, clientUserId);
             if (!existing) throw new Error("Failed to create or find user webhook link after conflict.");
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
            throw new Error("User webhook link not found for status update.");
        }
        return result.rows[0];
    } catch (err) {
        console.error("Error updating user webhook status:", err);
        throw new Error(`Database error updating user webhook status: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Links an agent to an existing user-webhook configuration.
 * Assumes the user-webhook link already exists and is ideally active.
 *
 * @param webhookId The ID of the webhook.
 * @param clientUserId The ID of the client user.
 * @param agentId The ID of the agent.
 * @returns The newly created WebhookAgentLinkRecord.
 * @throws Error if the corresponding webhook cannot be found to get providerId.
 */
export const linkAgentToWebhook = async (webhookId: string, clientUserId: string, agentId: string): Promise<WebhookAgentLinkRecord> => {
    // 1. Fetch the webhook to get the provider ID, required for the link table
    const webhook = await getWebhookById(webhookId);
    if (!webhook) {
        throw new Error(`Cannot link agent: Webhook with ID ${webhookId} not found.`);
    }
    const webhookProviderId = webhook.webhook_provider_id;

    // 2. Insert the link including the provider ID
    const sql = `
        INSERT INTO webhook_agent_links (webhook_id, client_user_id, agent_id, webhook_provider_id, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (webhook_id, client_user_id, agent_id) DO NOTHING
        RETURNING *;
    `;
    try {
        const result = await query<WebhookAgentLinkRecord>(sql, [webhookId, clientUserId, agentId, webhookProviderId]);
         if (result.rows.length === 0) {
             // If ON CONFLICT DO NOTHING and it conflicted, re-fetch the existing record.
             const existing = await findWebhookAgentLink(webhookId, clientUserId, agentId);
             if (!existing) throw new Error("Failed to create or find agent link after conflict.");
             return existing;
        }
        return result.rows[0];
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
export const findWebhookAgentLink = async (webhookId: string, clientUserId: string, agentId: string): Promise<WebhookAgentLinkRecord | null> => {
    const sql = "SELECT * FROM webhook_agent_links WHERE webhook_id = $1 AND client_user_id = $2 AND agent_id = $3";
    try {
        const result = await query<WebhookAgentLinkRecord>(sql, [webhookId, clientUserId, agentId]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (err) {
        console.error("Error finding webhook agent link:", err);
        throw new Error(`Database error finding agent link: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Helper to convert DB record to application-level Webhook type.
 * Parses JSON fields.
 */
export const mapWebhookRecordToWebhook = (record: WebhookRecord): Webhook => {
    return {
        id: record.id,
        name: record.name,
        description: record.description,
        webhookProviderId: record.webhook_provider_id,
        subscribedEventId: record.subscribed_event_id,
        // Safely parse JSON, assuming they are stored as strings
        requiredSecrets: typeof record.required_secrets === 'string' ? JSON.parse(record.required_secrets) : record.required_secrets,
        userIdentificationMapping: typeof record.user_identification_mapping === 'string' ? JSON.parse(record.user_identification_mapping) : record.user_identification_mapping,
        eventPayloadSchema: typeof record.event_payload_schema === 'string' ? JSON.parse(record.event_payload_schema) : record.event_payload_schema,
    };
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
    };
};

/**
 * Helper to convert DB record to application-level WebhookAgentLink type.
 */
export const mapWebhookAgentLinkRecordToWebhookAgentLink = (record: WebhookAgentLinkRecord): WebhookAgentLink => {
    return {
        webhookProviderId: record.webhook_provider_id as WebhookProviderId, // Cast if needed, assuming string matches enum
        clientUserId: record.client_user_id,
        agentId: record.agent_id,
    };
}; 