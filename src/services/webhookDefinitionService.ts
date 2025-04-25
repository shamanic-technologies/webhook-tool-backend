/**
 * Webhook Definition Service Layer
 *
 * Contains business logic and data access functions related to
 * the core webhook definitions (webhooks table).
 */
import { query } from '../lib/db.js';
import { WebhookRecord } from '../types/db.js';
import { WebhookData, Webhook, WebhookProviderId, UtilitySecretType } from '@agent-base/types';
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
export const createWebhookService = async (
    webhookData: WebhookData, // Uses application-level type
    embedding: number[]
): Promise<WebhookRecord> => {
    const newId = uuidv4(); // Use a different variable name than the type
    const {
      name, 
      description, 
      webhookProviderId, 
      subscribedEventId, 
      requiredSecrets, 
      clientUserIdentificationMapping, // Correct app-level name
      conversationIdIdentificationMapping, // Correct app-level name
      eventPayloadSchema 
    } = webhookData;
  
    // Convert arrays/objects to JSON strings for PG
    const requiredSecretsJson = JSON.stringify(requiredSecrets);
    const clientMappingJson = JSON.stringify(clientUserIdentificationMapping);
    // conversationIdIdentificationMapping is already a string
    const eventPayloadSchemaJson = JSON.stringify(eventPayloadSchema);
    const embeddingSql = embedding ? pgvector.toSql(embedding) : null;
  
    const sql = `
      INSERT INTO webhooks (
        id, name, description, webhook_provider_id, subscribed_event_id, 
        required_secrets, 
        client_user_identification_mapping, -- Correct DB column
        conversation_id_identification_mapping, -- Correct DB column
        event_payload_schema, 
        embedding, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *;
    `;
    try {
      const result = await query<WebhookRecord>(sql, [
        newId, name, description, webhookProviderId, subscribedEventId,
        requiredSecretsJson, 
        clientMappingJson, // Pass JSON string for JSONB column
        conversationIdIdentificationMapping, // Pass string directly for TEXT column
        eventPayloadSchemaJson, 
        embeddingSql
      ]);
      if (result.rows.length === 0) {
        throw new Error("Failed to create webhook definition, INSERT query returned no rows.");
      }
      return result.rows[0];
    } catch (err) {
      console.error("Error creating webhook definition:", err);
      throw new Error(`Database error creating webhook definition: ${err instanceof Error ? err.message : String(err)}`);
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
 * Finds a webhook definition by its provider ID and subscribed event ID.
 *
 * @param webhookProviderId The provider identifier (as string from URL).
 * @param subscribedEventId The unique event ID associated with the webhook URL.
 * @returns The WebhookRecord or null if not found.
 */
export const getWebhookByProviderAndEvent = async (
    webhookProviderId: string,
    subscribedEventId: string
): Promise<WebhookRecord | null> => {
    const sql = `
        SELECT * 
        FROM webhooks 
        WHERE webhook_provider_id = $1 AND subscribed_event_id = $2
    `;
    try {
        const result = await query<WebhookRecord>(sql, [webhookProviderId, subscribedEventId]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (err) {
        console.error("Error finding webhook by provider and event ID:", err);
        throw new Error(`Database error finding webhook definition: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Helper to convert DB record to application-level Webhook type.
 * Assumes JSON fields are parsed correctly by the DB driver or need parsing here.
 */
export const mapWebhookRecordToWebhook = (record: WebhookRecord): Webhook => {
    // Attempt to parse JSON fields, handle potential errors or assume driver handles it
    let requiredSecrets: UtilitySecretType[];
    let clientUserIdentificationMapping: Record<UtilitySecretType, string>;
    let eventPayloadSchema: Record<string, unknown>;

    try {
        requiredSecrets = typeof record.required_secrets === 'string' 
            ? JSON.parse(record.required_secrets) 
            : record.required_secrets; // Assuming driver parses JSONB to object/array
    } catch (e) {
        console.error(`Error parsing required_secrets for webhook ${record.id}:`, e);
        requiredSecrets = []; // Default to empty array on error
    }

    try {
        // Use correct snake_case DB column name
        clientUserIdentificationMapping = typeof record.client_user_identification_mapping === 'string' 
            ? JSON.parse(record.client_user_identification_mapping) 
            : record.client_user_identification_mapping;
    } catch (e) {
        console.error(`Error parsing client_user_identification_mapping for webhook ${record.id}:`, e);
        clientUserIdentificationMapping = {}; // Default to empty object on error
    }

    try {
        eventPayloadSchema = typeof record.event_payload_schema === 'string' 
            ? JSON.parse(record.event_payload_schema) 
            : record.event_payload_schema;
    } catch (e) {
        console.error(`Error parsing event_payload_schema for webhook ${record.id}:`, e);
        eventPayloadSchema = {}; // Default to empty object on error
    }

    return {
        id: record.id,
        name: record.name,
        description: record.description,
        webhookProviderId: record.webhook_provider_id,
        subscribedEventId: record.subscribed_event_id,
        requiredSecrets: requiredSecrets,
        // Use correct application-level field name
        clientUserIdentificationMapping: clientUserIdentificationMapping,
        // Use correct application-level field name (maps from correct DB column)
        conversationIdIdentificationMapping: record.conversation_id_identification_mapping,
        eventPayloadSchema: eventPayloadSchema,
    };
}; 