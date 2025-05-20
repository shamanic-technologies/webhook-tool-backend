/* eslint-disable @typescript-eslint/naming-convention */
import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// SQL function to update updated_at column
const UPDATE_UPDATED_AT_FN = `
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';
`;

// Trigger template
const CREATE_UPDATE_TRIGGER = (tableName: string) => `
CREATE TRIGGER update_${tableName}_updated_at BEFORE UPDATE
ON ${tableName} FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

// Drop trigger template
const DROP_UPDATE_TRIGGER = (tableName: string) => `
DROP TRIGGER IF EXISTS update_${tableName}_updated_at ON ${tableName};
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
    // Extensions
    pgm.createExtension('uuid-ossp', { ifNotExists: true });
    pgm.createExtension('vector', { ifNotExists: true });

    // Function for updated_at
    pgm.sql(UPDATE_UPDATED_AT_FN);

    // webhooks table
    pgm.createTable('webhooks', {
        id: {
            type: 'uuid',
            primaryKey: true,
            default: pgm.func('uuid_generate_v4()'),
        },
        name: { type: 'varchar(255)', notNull: true },
        description: { type: 'text', notNull: true },
        webhook_provider_id: { type: 'varchar(100)', notNull: true },
        subscribed_event_id: { type: 'varchar(255)', notNull: true },
        required_secrets: { type: 'jsonb', notNull: true, default: '[]' },
        user_identification_mapping: { type: 'jsonb', notNull: true, default: '{\}' },
        event_payload_schema: { type: 'jsonb', notNull: true, default: '{\}' },
        embedding: { type: 'vector(10)' }, // Adjust dimension as needed
        created_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('current_timestamp'),
        },
        updated_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('current_timestamp'),
        },
    });
    // Optional: Add vector index later once you have data and know access patterns
    // pgm.addIndex('webhooks', 'embedding', { method: 'hnsw', /* options */ }); 
    // pgm.addIndex('webhooks', 'embedding', { method: 'ivfflat', /* options */ });
    pgm.sql(CREATE_UPDATE_TRIGGER('webhooks'));

    // user_webhooks table
    pgm.createTable('user_webhooks', {
        webhook_id: {
            type: 'uuid',
            notNull: true,
            references: 'webhooks', // Foreign key
            onDelete: 'CASCADE',
        },
        client_user_id: { type: 'varchar(255)', notNull: true },
        status: {
            type: 'varchar(50)',
            notNull: true,
            // Optional: Add check constraint if your PG version supports it easily
            // check: "status IN ('active', 'pending', 'inactive')",
        },
        created_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('current_timestamp'),
        },
        updated_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('current_timestamp'),
        },
    });
    // Composite primary key
    pgm.addConstraint('user_webhooks', 'user_webhooks_pkey', {
        primaryKey: ['webhook_id', 'client_user_id'],
    });
    pgm.addIndex('user_webhooks', 'client_user_id');
    pgm.sql(CREATE_UPDATE_TRIGGER('user_webhooks'));

    // webhook_agent_links table (without webhook_provider_id)
    pgm.createTable('webhook_agent_links', {
        webhook_id: { type: 'uuid', notNull: true },
        client_user_id: { type: 'varchar(255)', notNull: true },
        agent_id: { type: 'varchar(255)', notNull: true },
        created_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('current_timestamp'),
        },
    });
    // Composite primary key
    pgm.addConstraint('webhook_agent_links', 'webhook_agent_links_pkey', {
        primaryKey: ['webhook_id', 'client_user_id', 'agent_id'],
    });
    // Foreign key constraint to user_webhooks
    pgm.addConstraint('webhook_agent_links', 'webhook_agent_links_fk_user_webhook', {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id'],
            references: 'user_webhooks(webhook_id, client_user_id)',
            onDelete: 'CASCADE',
        },
    });
    pgm.addIndex('webhook_agent_links', 'agent_id');
    // No updated_at trigger needed typically
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    // Drop tables in reverse order of creation, handling dependencies
    pgm.dropConstraint('webhook_agent_links', 'webhook_agent_links_fk_user_webhook');
    pgm.dropConstraint('webhook_agent_links', 'webhook_agent_links_pkey');
    pgm.dropTable('webhook_agent_links');

    pgm.dropConstraint('user_webhooks', 'user_webhooks_pkey');
    pgm.dropTable('user_webhooks'); // Drops indexes automatically
    
    pgm.dropTable('webhooks'); // Drops indexes and trigger automatically?
    // Explicitly drop triggers and function if needed
    pgm.sql(DROP_UPDATE_TRIGGER('webhooks'));
    pgm.sql(DROP_UPDATE_TRIGGER('user_webhooks'));
    pgm.sql('DROP FUNCTION IF EXISTS update_updated_at_column();');

    // Optional: Drop extensions if they are ONLY used by this schema
    // pgm.dropExtension('vector', { ifExists: true });
    // pgm.dropExtension('uuid-ossp', { ifExists: true });
}
