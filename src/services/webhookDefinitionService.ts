/**
 * Webhook Definition Service Layer
 *
 * Contains business logic and data access functions related to
 * the core webhook definitions (webhooks table).
 */
import { query } from '../lib/db.js';
import { WebhookRecord } from '../types/db.js';
import { WebhookData, Webhook } from '@agent-base/types';
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
    // TODO: Consider parsing JSON fields here if needed immediately, though mapping does it
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
  const embeddingSql = pgvector.toSql(queryVector);
  const sql = `
    SELECT *, 1 - (embedding <=> $1) AS similarity
    FROM webhooks
    ORDER BY embedding <=> $1
    LIMIT $2;
  `;
  try {
    const result = await query<WebhookRecord & { similarity: number }>(sql, [embeddingSql, limit]);
    return result.rows;
  } catch (err) {
    console.error("Error searching webhooks:", err);
    if (err instanceof Error && err.message.includes('column "embedding" does not exist')) {
        console.warn('Search failed: Webhook embedding column likely missing or not populated.');
        return [];
    }
    throw new Error(`Database error searching webhooks: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Helper to convert DB record to application-level Webhook type.
 * Parses JSON fields.
 */
export const mapWebhookRecordToWebhook = (record: WebhookRecord): Webhook => {
    try {
      return {
          id: record.id,
          name: record.name,
          description: record.description,
          webhookProviderId: record.webhook_provider_id,
          subscribedEventId: record.subscribed_event_id,
          // Safely parse JSON, handling potential errors if data is not valid JSON
          requiredSecrets: typeof record.required_secrets === 'string' ? JSON.parse(record.required_secrets) : (record.required_secrets || []),
          userIdentificationMapping: typeof record.user_identification_mapping === 'string' ? JSON.parse(record.user_identification_mapping) : (record.user_identification_mapping || {}),
          eventPayloadSchema: typeof record.event_payload_schema === 'string' ? JSON.parse(record.event_payload_schema) : (record.event_payload_schema || {}),
      };
    } catch (parseError) {
        console.error(`Error parsing JSON fields for webhook ${record.id}:`, parseError);
        // Return a potentially partial object or throw an error, depending on requirements
        // Returning partial object here to avoid crashing entirely if one record is bad
         return {
            id: record.id,
            name: record.name,
            description: record.description,
            webhookProviderId: record.webhook_provider_id,
            subscribedEventId: record.subscribed_event_id,
            requiredSecrets: [],
            userIdentificationMapping: {},
            eventPayloadSchema: {},
        } as Webhook; // Cast needed as it might not fully conform
    }
}; 