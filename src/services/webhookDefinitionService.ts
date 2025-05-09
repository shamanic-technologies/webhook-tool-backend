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

// --- Import UserWebhookLinkService and AgentWebhookLinkService ---
import * as userWebhookLinkService from './userWebhookLinkService.js';
import * as agentWebhookLinkService from './agentWebhookLinkService.js';

// --- Helper Function for Schema Path Validation --- 

/**
 * Validates if a dot-notation path exists within a given JSON schema structure.
 * Primarily checks nested properties.
 *
 * @param schema The JSON schema object.
 * @param path The dot-notation path string (e.g., "data.user.id").
 * @returns True if the path exists in the schema, false otherwise.
 */
const _validatePathInSchema = (schema: any, path: string): boolean => {
    if (!schema || typeof schema !== 'object' || !path) {
        return false;
    }
    const segments = path.split('.');
    let currentLevel = schema;

    for (const segment of segments) {
        // Check if the current level is an object and has properties
        if (currentLevel && typeof currentLevel === 'object' && currentLevel.properties) {
            // Check if the segment exists within the properties
            if (currentLevel.properties.hasOwnProperty(segment)) {
                currentLevel = currentLevel.properties[segment]; // Move to the next level
            } else {
                return false; // Segment not found in properties
            }
        } else {
            // Handle cases where the path references a top-level primitive or schema is malformed
            // For this validation, we primarily care about nested properties structure
            // A simple top-level check might be needed if the first segment isn't in properties
            if (segments.length === 1 && currentLevel.hasOwnProperty(segment)) {
                 return true; // Path is just a single top-level property
            } 
            // If not a recognized structure with properties for nesting, path is invalid
            return false;
        }
    }
    // If we successfully traversed all segments, the path exists
    return true;
};

/**
 * Creates a new webhook definition in the database.
 *
 * @param webhookData Data for the new webhook.
 * @param embedding Optional vector embedding for the webhook.
 * @param clientUserId The ID of the client user creating the webhook.
 * @returns The newly created WebhookRecord.
 * @throws Error if database insertion fails.
 */
export const createWebhookService = async (
    webhookData: WebhookData, // Uses application-level type
    embedding: number[],
    clientUserId: string // Add clientUserId parameter
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
  
    // --- Validation Step --- 
    if (!eventPayloadSchema || typeof eventPayloadSchema !== 'object') {
        throw new Error('Validation Error: eventPayloadSchema must be provided as an object.');
    }
    if (!clientUserIdentificationMapping || typeof clientUserIdentificationMapping !== 'object'){
        throw new Error('Validation Error: clientUserIdentificationMapping must be provided as an object.');
    }
    if (!conversationIdIdentificationMapping || typeof conversationIdIdentificationMapping !== 'string') {
        throw new Error('Validation Error: conversationIdIdentificationMapping must be provided as a string.');
    }
    if (!requiredSecrets || !Array.isArray(requiredSecrets)) {
        throw new Error('Validation Error: requiredSecrets must be provided as an array.');
    }

    // 1. Validate clientUserIdentificationMapping paths against schema and requiredSecrets
    for (const [secretType, path] of Object.entries(clientUserIdentificationMapping)) {
        if (typeof path !== 'string') {
             throw new Error(`Validation Error: Path for client identifier '${secretType}' must be a string.`);
        }
        if (!_validatePathInSchema(eventPayloadSchema, path)) {
            throw new Error(`Validation Error: Path '${path}' for client identifier '${secretType}' not found in eventPayloadSchema.`);
        }
        if (!requiredSecrets.includes(secretType as UtilitySecretType)) {
            throw new Error(`Validation Error: Client identifier '${secretType}' is mapped but not listed in requiredSecrets.`);
        }
    }

    // 2. Validate conversationIdIdentificationMapping path against schema
    if (!_validatePathInSchema(eventPayloadSchema, conversationIdIdentificationMapping)) {
        throw new Error(`Validation Error: Path '${conversationIdIdentificationMapping}' for conversation identifier not found in eventPayloadSchema.`);
    }
    // --- End Validation --- 
  
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
        embedding, 
        creator_client_user_id, -- Add new column here
        created_at, 
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()) -- Add $11 for the new value
      RETURNING *;
    `;
    try {
      const result = await query<WebhookRecord>(sql, [
        newId, name, description, webhookProviderId, subscribedEventId,
        requiredSecretsJson, 
        clientMappingJson, // Pass JSON string for JSONB column
        conversationIdIdentificationMapping, // Pass string directly for TEXT column
        eventPayloadSchemaJson, 
        embeddingSql,
        clientUserId // Pass the clientUserId for the new column
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
 * Searches for webhooks based on a query vector (cosine similarity) or lists all if queryVector is null.
 *
 * @param clientUserId The ID of the client user who created the webhooks.
 * @param queryVector The vector representation of the search query, or null to list all.
 * @param limit The maximum number of results to return.
 * @returns An array of matching Webhooks, enhanced with URL and link status.
 * @throws Error if database query fails.
 */
export const searchWebhooks = async (clientUserId: string, queryVector: number[] | null, limit: number): Promise<Webhook[]> => {
  let sql: string;
  let queryParams: any[];

  if (queryVector) {
    const embeddingSql = pgvector.toSql(queryVector);
    sql = `
      SELECT *, 1 - (embedding <=> $1) AS similarity
      FROM webhooks
      WHERE creator_client_user_id = $3 -- Filter by clientUserId
      ORDER BY embedding <=> $1
      LIMIT $2;
    `;
    queryParams = [embeddingSql, limit, clientUserId];
  } else {
    // No queryVector, fetch all webhooks for the user, ordered by creation date
    sql = `
      SELECT *
      FROM webhooks
      WHERE creator_client_user_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    queryParams = [clientUserId, limit];
  }

  try {
    // The result type from the query might not have 'similarity' if queryVector is null
    const result = await query<WebhookRecord & { similarity?: number }>(sql, queryParams);
    
    const enhancedWebhooks: Webhook[] = await Promise.all(
      result.rows.map(async (record: WebhookRecord & { similarity?: number }) => { // Explicitly type 'record'
        const baseWebhook = mapWebhookRecordToWebhook(record);

        // 1. Construct webhookUrl
        const webhookUrl = `${process.env.WEBHOOK_URL}/${baseWebhook.webhookProviderId}/${baseWebhook.subscribedEventId}`;

        // 2. Get UserWebhook link details
        const userLink = await userWebhookLinkService.findUserWebhook(baseWebhook.id, clientUserId);
        const isLinkedToCurrentUser = !!userLink; // Boolean: true if userLink exists
        const currentUserWebhookStatus = userLink ? userLink.status : undefined; // Actual status or undefined

        // 3. Check if linked to an agent (in the context of this user)
        let linkedAgentId: string | undefined = undefined;
        let isLinkedToAgent = false; // Default to false, will become true if an agent is linked
        // Ensure userLink and its platform_user_id are valid before proceeding
        if (userLink && userLink.platform_user_id) { 
            const agentLinkRecord = await agentWebhookLinkService.findAgentLink(baseWebhook.id, clientUserId, userLink.platform_user_id);
            if (agentLinkRecord && agentLinkRecord.agent_id) {
                linkedAgentId = agentLinkRecord.agent_id;
                isLinkedToAgent = true; // Set to true if agent is linked
            }
        }

        return {
          ...baseWebhook,
          webhookUrl,
          isLinkedToCurrentUser,    // Populate based on userLink existence
          currentUserWebhookStatus, // Populate with actual status from userLink
          isLinkedToAgent,          // Populate with explicit boolean
          linkedAgentId,            // Populate with agent ID or undefined
        };
      })
    );
    
    return enhancedWebhooks;
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
export const getWebhooksByProviderAndEvent = async (
    webhookProviderId: string,
    subscribedEventId: string
): Promise<WebhookRecord[]> => {
    const sql = `
        SELECT * 
        FROM webhooks 
        WHERE webhook_provider_id = $1 AND subscribed_event_id = $2
    `;
    try {
        const result = await query<WebhookRecord>(sql, [webhookProviderId, subscribedEventId]);
        return result.rows;
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

    // Construct webhookUrl, ensuring provider_id and event_id are present
    const webhookUrl = (record.webhook_provider_id && record.subscribed_event_id)
                       ? `${process.env.WEBHOOK_URL}/${record.webhook_provider_id}/${record.subscribed_event_id}`
                       : 'invalid_url_missing_data'; // Or a more robust error/default handling

    if (webhookUrl === 'invalid_url_missing_data') {
        console.warn(`Could not construct webhookUrl for webhook ID ${record.id} due to missing provider or event ID. WEBHOOK_URL env: ${process.env.WEBHOOK_URL}`);
    }

    return {
        id: record.id,
        name: record.name,
        description: record.description,
        webhookProviderId: record.webhook_provider_id,
        subscribedEventId: record.subscribed_event_id,
        requiredSecrets: requiredSecrets,
        clientUserIdentificationMapping: clientUserIdentificationMapping,
        conversationIdIdentificationMapping: record.conversation_id_identification_mapping,
        eventPayloadSchema: eventPayloadSchema,
        webhookUrl: webhookUrl, // Added to satisfy Webhook type
    };
};

/**
 * Retrieves all webhook definitions created by a specific client user.
 *
 * @param clientUserId The ID of the client user who created the webhooks.
 * @returns An array of WebhookRecords created by the user.
 * @throws Error if database query fails.
 */
export const getUserCreatedWebhooksService = async (clientUserId: string): Promise<WebhookRecord[]> => {
    const sql = `
        SELECT *
        FROM webhooks
        WHERE creator_client_user_id = $1
        ORDER BY created_at DESC;
    `;
    try {
        const result = await query<WebhookRecord>(sql, [clientUserId]);
        return result.rows;
    } catch (err) {
        console.error("Error retrieving user's created webhooks:", err);
        throw new Error(`Database error retrieving created webhooks: ${err instanceof Error ? err.message : String(err)}`);
    }
}; 