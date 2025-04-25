/**
 * Database Record Type Definitions
 *
 * Defines TypeScript interfaces for the structure of records
 * retrieved from or inserted into the database tables.
 * Uses snake_case for field names corresponding to table columns.
 */
import { 
    WebhookStatus, 
    WebhookProviderId, 
    UtilitySecretType 
} from '@agent-base/types';

/**
 * Represents the structure of a record in the 'webhooks' table.
 */
export interface WebhookRecord {
    id: string; // UUID, primary key
    name: string;
    description: string;
    webhook_provider_id: WebhookProviderId;
    subscribed_event_id: string;
    required_secrets: UtilitySecretType[]; // Stored as JSONB or TEXT[] in PG
    client_user_identification_mapping: Record<UtilitySecretType, string>; // Added (Stored as JSONB in PG)
    conversation_id_identification_mapping: string; // Added (Stored as TEXT in PG)
    event_payload_schema: Record<string, unknown>; // Stored as JSONB in PG
    embedding?: number[]; // Assuming numeric vector, adjust if needed
    created_at: Date;
    updated_at: Date;
}

/**
 * Represents the structure of a record in the 'user_webhooks' table.
 * Links a client user to a specific webhook configuration.
 */
export interface UserWebhookRecord {
    webhook_id: string; // Foreign key to webhooks.id
    client_user_id: string; // Identifier for the user in the client's system
    platform_user_id: string; // Added platform user ID
    status: WebhookStatus; // e.g., 'pending', 'active'
    client_user_identification_hash: string | null; // Added hash field (snake_case, nullable)
    created_at: Date;
    updated_at: Date;
}

/**
 * Represents the structure of a record in the 'webhook_agent_links' table.
 * Links an active user webhook configuration to a specific agent.
 */
export interface WebhookAgentLinkRecord {
    webhook_id: string; // Foreign key to webhooks.id
    client_user_id: string; // Identifier for the user in the client's system
    platform_user_id: string; // Added platform user ID
    agent_id: string; // Identifier for the agent
    created_at: Date;
    // client_user_id: string; // Foreign key to user_webhooks
    // webhook_provider_id: string; // Added to match WebhookAgentLink type and migration
    // Primary key would likely be a composite key (webhook_id, client_user_id, agent_id)
    // or have a unique constraint on (webhook_id, client_user_id)
} 