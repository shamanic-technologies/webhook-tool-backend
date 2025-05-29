/* eslint-disable @typescript-eslint/naming-convention */
// @ts-check

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

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
const CREATE_UPDATE_TRIGGER = (tableName) => `
CREATE TRIGGER update_${tableName}_updated_at BEFORE UPDATE
ON ${tableName} FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

// Drop trigger template
const DROP_UPDATE_TRIGGER = (tableName) => `
DROP TRIGGER IF EXISTS update_${tableName}_updated_at ON ${tableName};
`;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
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
        user_identification_mapping: { type: 'jsonb', notNull: true, default: '{}' },
        event_payload_schema: { type: 'jsonb', notNull: true, default: '{}' },
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
    pgm.addConstraint('webhook_agent_links', 'webhook_agent_links_pkey', {
        primaryKey: ['webhook_id', 'client_user_id', 'agent_id'],
    });
    pgm.addConstraint('webhook_agent_links', 'webhook_agent_links_fk_user_webhook', {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id'],
            references: 'user_webhooks(webhook_id, client_user_id)',
            onDelete: 'CASCADE',
        },
    });
    pgm.addIndex('webhook_agent_links', 'agent_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
    pgm.dropConstraint('webhook_agent_links', 'webhook_agent_links_fk_user_webhook');
    pgm.dropConstraint('webhook_agent_links', 'webhook_agent_links_pkey');
    pgm.dropTable('webhook_agent_links');

    pgm.dropConstraint('user_webhooks', 'user_webhooks_pkey');
    pgm.dropTable('user_webhooks'); 
    
    pgm.dropTable('webhooks'); 
    pgm.sql(DROP_UPDATE_TRIGGER('webhooks'));
    pgm.sql(DROP_UPDATE_TRIGGER('user_webhooks'));
    pgm.sql('DROP FUNCTION IF EXISTS update_updated_at_column();');
}; 