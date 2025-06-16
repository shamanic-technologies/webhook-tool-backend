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
    UtilitySecretType,
    Webhook
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
    conversation_id_identification_mapping: string; // Added (Stored as TEXT in PG)
    embedding?: number[]; // Assuming numeric vector, adjust if needed
    creator_client_user_id: string; // Added: ID of the user who created this webhook definition
    creator_client_organization_id: string; // Added: ID of the organization who created this webhook definition
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
    client_organization_id: string; // Added: ID of the organization who created this webhook definition
    platform_user_id: string; // Added platform user ID
    status: WebhookStatus; // e.g., 'pending', 'active'
    webhook_secret: string; // Unique secret for this webhook link
    created_at: Date;
    updated_at: Date;
}

export interface WebhookEventRecord {
    id: string; // Unique identifier for the event record
    webhook_id: string;
    client_user_id: string;
    client_organization_id: string;
    platform_user_id: string;
    payload: Record<string, unknown>;
    provider_id: string;
    subscribed_event_id: string;
    webhook_secret: string;
    conversation_id?: string;
    agent_id?: string;
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
    client_organization_id: string; // Added: ID of the organization who created this webhook definition
    platform_user_id: string; // Added platform user ID
    agent_id: string; // Identifier for the agent
    created_at: Date;
    updated_at: Date;
}

export function mapWebhookRecordToWebhook(record: WebhookRecord): Webhook {
    return {
        id: record.id,
        name: record.name,
        description: record.description,
        webhookProviderId: record.webhook_provider_id,
        subscribedEventId: record.subscribed_event_id,
        creatorClientUserId: record.creator_client_user_id,
        creatorClientOrganizationId: record.creator_client_organization_id,
        conversationIdIdentificationMapping: record.conversation_id_identification_mapping,
    };
}