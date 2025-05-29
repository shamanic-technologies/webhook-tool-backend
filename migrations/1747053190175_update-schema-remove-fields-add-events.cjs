/* eslint-disable @typescript-eslint/naming-convention */
// @ts-check

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

// Function to get the update trigger SQL
const CREATE_UPDATE_TRIGGER = (tableName) => `
CREATE TRIGGER update_${tableName}_updated_at BEFORE UPDATE
ON ${tableName} FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

// Function to get the drop trigger SQL
const DROP_UPDATE_TRIGGER = (tableName) => `
DROP TRIGGER IF EXISTS update_${tableName}_updated_at ON ${tableName};
`;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
    // --- Drop columns ---
    // Drop columns from 'webhooks' table
    try {
        await pgm.dropColumn('webhooks', 'client_user_identification_mapping');
    } catch (err) {
        console.warn("Column 'client_user_identification_mapping' not found on 'webhooks', might have been dropped or renamed already.");
        try {
            await pgm.dropColumn('webhooks', 'user_identification_mapping');
        } catch (innerErr) {
             console.warn("Column 'user_identification_mapping' also not found on 'webhooks'.");
        }
    }
    await pgm.dropColumn('webhooks', 'event_payload_schema');
    await pgm.dropColumn('webhooks', 'required_secrets');

    // Drop column from 'user_webhooks' table
    try {
        await pgm.dropColumn('user_webhooks', 'client_user_identification_hash');
    } catch (err) {
        console.warn("Column 'client_user_identification_hash' not found on 'user_webhooks', might have been dropped already.");
    }

    // --- Create 'webhook_events' table ---
    await pgm.createTable('webhook_events', {
        id: {
            type: 'uuid',
            primaryKey: true,
            default: pgm.func('uuid_generate_v4()'),
        },
        payload: { type: 'jsonb', notNull: true },
        provider_id: { type: 'varchar(100)', notNull: true },
        subscribed_event_id: { type: 'varchar(255)', notNull: true },
        client_user_id: { type: 'varchar(255)', notNull: true },
        webhook_secret: { type: 'text', notNull: true },
        conversation_id: { type: 'varchar(255)', notNull: false },
        webhook_id: {
            type: 'uuid',
            notNull: true,
            references: 'webhooks',
            onDelete: 'CASCADE',
        },
        agent_id: { type: 'varchar(255)', notNull: false },
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

    // Add foreign key constraint to user_webhooks using the composite key
    // The primary key on user_webhooks was changed to include platform_user_id
    // We need platform_user_id in webhook_events to create the foreign key
    // Add platform_user_id column first
    pgm.addColumn('webhook_events', {
        platform_user_id: {
            type: 'varchar(255)',
            notNull: true // Should match notNull constraint in user_webhooks
                         // If user_webhooks.platform_user_id can be null, set notNull: false here
        }
    });

    await pgm.addConstraint('webhook_events', 'webhook_events_fk_user_webhook', {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id', 'platform_user_id'], // Match the PK columns
            references: 'user_webhooks(webhook_id, client_user_id, platform_user_id)', // Reference the correct PK
            onDelete: 'CASCADE',
        },
    });

    // Add indexes
    await pgm.addIndex('webhook_events', 'webhook_id');
    await pgm.addIndex('webhook_events', 'client_user_id');
    await pgm.addIndex('webhook_events', 'conversation_id');
    await pgm.addIndex('webhook_events', 'agent_id');
    await pgm.addIndex('webhook_events', ['provider_id', 'subscribed_event_id']);
    await pgm.addIndex('webhook_events', 'platform_user_id'); // Index for the new FK column

    // Add updated_at trigger
    await pgm.sql(CREATE_UPDATE_TRIGGER('webhook_events'));
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
    // --- Revert 'webhook_events' table creation ---
    await pgm.sql(DROP_UPDATE_TRIGGER('webhook_events'));
    await pgm.dropConstraint('webhook_events', 'webhook_events_fk_user_webhook');
    // Drop the added column before dropping the table or in specific order if needed
    // It's safer to drop constraints/indexes first, then columns, then table
    await pgm.dropColumn('webhook_events', 'platform_user_id'); // Drop added column
    await pgm.dropTable('webhook_events');

    // --- Re-add columns ---
    await pgm.addColumn('user_webhooks', {
         client_user_identification_hash: { type: 'varchar(255)', notNull: false }
    });

    await pgm.addColumn('webhooks', {
        required_secrets: { type: 'jsonb', notNull: true, default: '[]' },
        client_user_identification_mapping: { type: 'jsonb', notNull: true, default: '{}' },
        event_payload_schema: { type: 'jsonb', notNull: true, default: '{}' },
    });
}; 