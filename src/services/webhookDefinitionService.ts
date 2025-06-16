/**
 * Webhook Definition Service Layer
 *
 * Contains business logic and data access functions related to
 * the core webhook definitions (webhooks table).
 */
import { query } from '../lib/db.js';
import { WebhookRecord } from '../types/db.js';
import { 
    WebhookData, 
    Webhook, 
    WebhookProviderId, 
    UtilitySecretType, 
    SearchWebhookResult,
    SearchWebhookResultItem
} from '@agent-base/types';
import pgvector from 'pgvector/pg'; // Import for vector type usage
import { v4 as uuidv4 } from 'uuid'; // For generating webhook IDs
import { constructWebhookTargetUrl } from '../lib/urlUtils.js'; // Import the helper

// --- Import UserWebhookLinkService and AgentWebhookLinkService ---
import * as userWebhookLinkService from './userWebhookLinkService.js';
import * as agentWebhookLinkService from './agentWebhookLinkService.js';

// --- Helper Function for Schema Path Validation --- 

// /**
//  * Validates if a dot-notation path exists within a given JSON schema structure.
//  * Primarily checks nested properties.
//  *
//  * @param schema The JSON schema object.
//  * @param path The dot-notation path string (e.g., "data.user.id").
//  * @returns True if the path exists in the schema, false otherwise.
//  */
// const _validatePathInSchema = (schema: any, path: string): boolean => {
//     if (!schema || typeof schema !== 'object' || !path) {
//         return false;
//     }
//     const segments = path.split('.');
//     let currentLevel = schema;

//     for (const segment of segments) {
//         // Check if the current level is an object and has properties
//         if (currentLevel && typeof currentLevel === 'object' && currentLevel.properties) {
//             // Check if the segment exists within the properties
//             if (currentLevel.properties.hasOwnProperty(segment)) {
//                 currentLevel = currentLevel.properties[segment]; // Move to the next level
//             } else {
//                 return false; // Segment not found in properties
//             }
//         } else {
//             // Handle cases where the path references a top-level primitive or schema is malformed
//             // For this validation, we primarily care about nested properties structure
//             // A simple top-level check might be needed if the first segment isn't in properties
//             if (segments.length === 1 && currentLevel.hasOwnProperty(segment)) {
//                  return true; // Path is just a single top-level property
//             } 
//             // If not a recognized structure with properties for nesting, path is invalid
//             return false;
//         }
//     }
//     // If we successfully traversed all segments, the path exists
//     return true;
// };

/**
 * Creates a new webhook definition in the database.
 *
 * @param webhookData Data for the new webhook.
 * @param embedding Optional vector embedding for the webhook.
 * @param clientUserId The ID of the client user creating the webhook.
 * @returns The newly created WebhookRecord.
 * @throws Error if database insertion fails.
 */
export const createWebhook = async (
    webhookData: WebhookData, // Uses application-level type
    embedding: number[],
    clientUserId: string, // Add clientUserId parameter
    clientOrganizationId: string,
): Promise<Webhook> => {
    const newId = uuidv4(); // Use a different variable name than the type
    const {
      name, 
      description, 
      webhookProviderId, 
      subscribedEventId, 
      conversationIdIdentificationMapping, // Correct app-level name
    } = webhookData;
  
    // --- Validation Step --- 
    if (!conversationIdIdentificationMapping || typeof conversationIdIdentificationMapping !== 'string') {
        throw new Error('Validation Error: conversationIdIdentificationMapping must be provided as a string.');
    }
    // --- End Validation --- 
  
    const embeddingSql = embedding ? pgvector.toSql(embedding) : null;
  
    const sql = `
      INSERT INTO webhooks (
        id, name, description, webhook_provider_id, subscribed_event_id, 
        conversation_id_identification_mapping, -- Correct DB column
        embedding, 
        creator_client_user_id, -- Add new column here
        creator_client_organization_id,
        created_at, 
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) -- Corrected to 8 placeholders + 2 NOW()
      RETURNING *;
    `;
    try {
      const result = await query<WebhookRecord>(sql, [
        newId, name, description, webhookProviderId, subscribedEventId,
        conversationIdIdentificationMapping, // Pass string directly for TEXT column
        embeddingSql,
        clientUserId, // Pass the clientUserId for the new column
        clientOrganizationId,
      ]);
      if (result.rows.length === 0) {
        throw new Error("Failed to create webhook definition, INSERT query returned no rows.");
      }
      return mapWebhookRecordToWebhook(result.rows[0]);
    } catch (err) {
      console.error("Error creating webhook definition:", err);
      throw new Error(`Database error creating webhook definition: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

/**
 * Renames a webhook definition in the database.
 *
 * @param webhookId The ID of the webhook to rename.
 * @param newName The new name for the webhook.
 * @param clientUserId The ID of the client user renaming the webhook.
 * @param clientOrganizationId The ID of the client organization.
 * @returns The updated Webhook.
 * @throws Error if the webhook is not found or the update fails.
 */
export const renameWebhook = async (
    webhookId: string,
    newName: string,
    clientUserId: string,
    clientOrganizationId: string
): Promise<Webhook> => {
    const sql = `
        UPDATE webhooks
        SET name = $1, updated_at = NOW()
        WHERE id = $2 AND creator_client_user_id = $3 AND creator_client_organization_id = $4
        RETURNING *;
    `;
    try {
        const result = await query<WebhookRecord>(sql, [newName, webhookId, clientUserId, clientOrganizationId]);
        if (result.rows.length === 0) {
            console.error("Webhook not found or user does not have permission to rename it.");
            throw new Error("Webhook not found or user does not have permission to rename it.");
        }
        return mapWebhookRecordToWebhook(result.rows[0]);
    } catch (err) {
        console.error("Error renaming webhook:", err);
        throw new Error(`Database error renaming webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Deletes a webhook definition from the database.
 *
 * @param webhookId The ID of the webhook to delete.
 * @param clientUserId The ID of the client user deleting the webhook.
 * @param clientOrganizationId The ID of the client organization.
 * @returns A boolean indicating whether the deletion was successful.
 * @throws Error if the webhook is not found or the deletion fails.
 */
export const deleteWebhook = async (
    webhookId: string,
    clientUserId: string,
    clientOrganizationId: string
): Promise<boolean> => {
    const sql = `
        DELETE FROM webhooks
        WHERE id = $1 AND creator_client_user_id = $2 AND creator_client_organization_id = $3;
    `;
    try {
        const result = await query(sql, [webhookId, clientUserId, clientOrganizationId]);
        if (!result.rowCount) {
            console.error("Webhook not found or user does not have permission to delete it.");
            throw new Error("Webhook not found or user does not have permission to delete it.");
        }
        return true;
    } catch (err) {
        console.error("Error deleting webhook:", err);
        throw new Error(`Database error deleting webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Retrieves a webhook definition by its ID.
 *
 * @param id The UUID of the webhook.
 * @returns The WebhookRecord or null if not found.
 * @throws Error if database query fails.
 */
export const getWebhookById = async (id: string): Promise<Webhook | null> => {
  const sql = "SELECT * FROM webhooks WHERE id = $1";
  try {
    const result = await query<WebhookRecord>(sql, [id]);
    if (result.rows.length === 0) {
      return null;
    }

    // TODO: Consider parsing JSON fields here if needed immediately, though mapping does it
    return mapWebhookRecordToWebhook(result.rows[0]);
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
 * @returns An object containing the items and total count of matching webhooks.
 * @throws Error if database query fails.
 */
export const searchWebhooks = async (
    clientUserId: string,
    clientOrganizationId: string,
    queryVector: number[] | null,
    limit: number
): Promise<SearchWebhookResult> => {
    let sql: string;
    let queryParams: any[];
    let countSql: string;
    let countParams: any[];

    if (queryVector) {
        const embeddingSql = pgvector.toSql(queryVector);
        sql = `
            SELECT *, 1 - (embedding <=> $1) AS similarity
            FROM webhooks
            WHERE creator_client_user_id = $3 AND creator_client_organization_id = $4 -- Filter by clientUserId and clientOrganizationId
            ORDER BY embedding <=> $1
            LIMIT $2;
        `;
        queryParams = [embeddingSql, limit, clientUserId, clientOrganizationId];

        // Count query for vector search (WHERE clause matches)
        countSql = `SELECT COUNT(*) FROM webhooks WHERE creator_client_user_id = $1 AND creator_client_organization_id = $2`;
        // For vector search count, we usually count all items matching the filter, 
        // not just those above a similarity threshold, unless specified.
        countParams = [clientUserId, clientOrganizationId]; 
    } else {
        // No queryVector, fetch all webhooks for the user, ordered by creation date
        sql = `
            SELECT *
            FROM webhooks
            WHERE creator_client_user_id = $1 AND creator_client_organization_id = $2
            ORDER BY created_at DESC
            LIMIT $2;
        `;
        queryParams = [clientUserId, clientOrganizationId, limit];

        // Count query for non-vector search
        countSql = `SELECT COUNT(*) FROM webhooks WHERE creator_client_user_id = $1 AND creator_client_organization_id = $2`;
        countParams = [clientUserId, clientOrganizationId];
    }

    try {
        // Execute count query
        const countResult = await query<{ count: string }>(countSql, countParams);
        const totalCount = parseInt(countResult.rows[0]?.count || '0', 10);

        // If count is 0, return early
        if (totalCount === 0) {
            return { items: [], total: totalCount };
        }

        // The result type from the query might not have 'similarity' if queryVector is null
        const result = await query<WebhookRecord & { similarity?: number }>(sql, queryParams);
        
        // Map to SearchWebhookResultItem
        const searchResultItems: SearchWebhookResultItem[] = await Promise.all(
            result.rows.map(async (record: WebhookRecord & { similarity?: number }) => { // Explicitly type 'record'
                // Directly use record fields relevant to SearchWebhookResultItem
                // UserWebhook link details
                const userLink = await userWebhookLinkService.findUserWebhook(record.id, clientUserId, clientOrganizationId);
                const isLinkedToCurrentUser = !!userLink; // Boolean: true if userLink exists
                const currentUserWebhookStatus = userLink ? userLink.status : undefined; // Actual status or undefined

                // 3. Check if linked to an agent (in the context of this user)
                let linkedAgentId: string | undefined = undefined;
                let isLinkedToAgent = false; // Default to false, will become true if an agent is linked
                // Ensure userLink and its platformUserId are valid before proceeding
                if (userLink && userLink.platformUserId) { 
                    const agentLinkRecord = await agentWebhookLinkService.findAgentLink(record.id, clientUserId, clientOrganizationId);
                    if (agentLinkRecord && agentLinkRecord.agentId) {
                        linkedAgentId = agentLinkRecord.agentId;
                        isLinkedToAgent = true; // Set to true if agent is linked
                    }
                }

                // Construct SearchWebhookResultItem
                return {
                    id: record.id,
                    name: record.name,
                    description: record.description,
                    webhookProviderId: record.webhook_provider_id,
                    subscribedEventId: record.subscribed_event_id,
                    isLinkedToCurrentUser,    // Populate based on userLink existence
                    currentUserWebhookStatus, // Populate with actual status from userLink
                    isLinkedToAgent,          // Populate with explicit boolean
                    linkedAgentId,            // Populate with agent ID or undefined
                };
            })
        );
        
        return { items: searchResultItems, total: totalCount };
    } catch (err) {
        console.error("Error searching webhooks:", err);
        if (err instanceof Error && err.message.includes('column "embedding" does not exist')) {
            console.warn('Search failed: Webhook embedding column likely missing or not populated.');
            return { items: [], total: 0 };
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
export const getWebhookRecordsByProviderAndEvent = async (
    webhookProviderId: string,
    subscribedEventId: string,
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
const mapWebhookRecordToWebhook = async (record: WebhookRecord): Promise<Webhook> => {

  return {
      id: record.id,
      name: record.name,
      description: record.description,
      webhookProviderId: record.webhook_provider_id,
      subscribedEventId: record.subscribed_event_id,
      conversationIdIdentificationMapping: record.conversation_id_identification_mapping,
      creatorClientUserId: record.creator_client_user_id,
      creatorClientOrganizationId: record.creator_client_organization_id,
  };
};

/**
 * Retrieves all webhook definitions created by a specific client user, enhanced with linkage information.
 *
 * @param clientUserId The ID of the client user who created the webhooks.
 * @returns An object containing the items and total count of matching webhooks.
 * @throws Error if database query fails.
 */
export const getUserCreatedWebhooksService = async (
    clientUserId: string,
    clientOrganizationId: string,
): Promise<SearchWebhookResult> => {
    const sql = `
        SELECT *
        FROM webhooks
        WHERE creator_client_user_id = $1
        AND creator_client_organization_id = $2
        ORDER BY created_at DESC;
    `;
    try {
        const result = await query<WebhookRecord>(sql, [clientUserId, clientOrganizationId]);
        
        const searchResultItems: SearchWebhookResultItem[] = await Promise.all(
            result.rows.map(async (record: WebhookRecord) => {
                // Directly map record fields + linkage info to SearchWebhookResultItem
                // Get UserWebhook link details
                const userLink = await userWebhookLinkService.findUserWebhook(record.id, clientUserId, clientOrganizationId);
                const isLinkedToCurrentUser = !!userLink;
                const currentUserWebhookStatus = userLink ? userLink.status : undefined;

                // Check if linked to an agent
                let linkedAgentId: string | undefined = undefined;
                let isLinkedToAgent = false;
                if (userLink && userLink.platformUserId) {
                    const agentLinkRecord = await agentWebhookLinkService.findAgentLink(record.id, clientUserId, clientOrganizationId);
                    if (agentLinkRecord && agentLinkRecord.agentId) {
                        linkedAgentId = agentLinkRecord.agentId;
                        isLinkedToAgent = true;
                    }
                }

                return {
                    id: record.id,
                    name: record.name,
                    description: record.description,
                    webhookProviderId: record.webhook_provider_id,
                    subscribedEventId: record.subscribed_event_id,
                    isLinkedToCurrentUser,
                    currentUserWebhookStatus,
                    isLinkedToAgent,
                    linkedAgentId,
                };
            })
        );
        return { items: searchResultItems, total: searchResultItems.length };
    } catch (err) {
        console.error("Error retrieving user's created webhooks:", err);
        throw new Error(`Database error retrieving created webhooks: ${err instanceof Error ? err.message : String(err)}`);
    }
};

/**
 * Updates a webhook definition in the database.
 *
 * @param webhookId The ID of the webhook to update.
 * @param updates The data to update.
 * @param clientUserId The ID of the client user updating the webhook.
 * @param clientOrganizationId The ID of the client organization.
 * @returns The updated Webhook.
 * @throws Error if the webhook is not found or the update fails.
 */
export const updateWebhook = async (
    webhookId: string,
    updates: Partial<WebhookData>,
    clientUserId: string,
    clientOrganizationId: string
): Promise<Webhook> => {
    const updateFields = Object.keys(updates);
    if (updateFields.length === 0) {
        const webhook = await getWebhookById(webhookId);
        if (!webhook) {
            console.error("Webhook not found.");
            throw new Error("Webhook not found.");
        }
        return webhook;
    }

    const setClauses = updateFields.map((field, index) => `"${field}" = $${index + 1}`).join(', ');
    const params = updateFields.map(field => updates[field as keyof typeof updates]);
    
    params.push(webhookId, clientUserId, clientOrganizationId);

    const sql = `
        UPDATE webhooks
        SET ${setClauses}, updated_at = NOW()
        WHERE id = $${params.length - 2} AND creator_client_user_id = $${params.length - 1} AND creator_client_organization_id = $${params.length}
        RETURNING *;
    `;

    try {
        const result = await query<WebhookRecord>(sql, params);
        if (result.rows.length === 0) {
            console.error("Webhook not found or user does not have permission to update it.");
            throw new Error("Webhook not found or user does not have permission to update it.");
        }
        return mapWebhookRecordToWebhook(result.rows[0]);
    } catch (err) {
        console.error("Error updating webhook:", err);
        throw new Error(`Database error updating webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
};