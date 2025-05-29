// @ts-check
/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
    // This migration changes several key columns from UUID to TEXT to allow for non-UUID string identifiers.
    // It involves webhooks.id (Primary Key), and foreign keys referencing it in user_webhooks and webhook_events.
    // It also changes client_user_id in user_webhooks and webhook_events to TEXT.
    // Columns in webhook_agent_links that form foreign keys are also changed to TEXT.
    // Foreign key constraints must be dropped before altering column types and then re-added.
    // Additionally, a UNIQUE constraint is added to user_webhooks(webhook_id, client_user_id) 
    // to support existing FKs that referenced the old composite PK on those two columns.

    // Step 1: Drop all relevant Foreign Key constraints
    await pgm.dropConstraint('webhook_agent_links', 'webhook_agent_links_fk_user_webhook', { ifExists: true });
    await pgm.dropConstraint('webhook_events', 'webhook_events_fk_user_webhook', { ifExists: true });
    await pgm.dropConstraint('webhook_events', 'webhook_events_webhook_id_fkey', { ifExists: true });
    await pgm.dropConstraint('user_webhooks', 'user_webhooks_webhook_id_fkey', { ifExists: true });

    // Step 2: Alter Primary Key and Foreign Key column types to TEXT
    pgm.alterColumn('webhooks', 'id', { type: 'TEXT' });
    pgm.alterColumn('user_webhooks', 'webhook_id', { type: 'TEXT' });
    pgm.alterColumn('user_webhooks', 'client_user_id', { type: 'TEXT' });

    // Alter columns in webhook_agent_links that will form the FK to user_webhooks
    pgm.alterColumn('webhook_agent_links', 'webhook_id', { type: 'TEXT' });
    pgm.alterColumn('webhook_agent_links', 'client_user_id', { type: 'TEXT' });

    pgm.alterColumn('webhook_events', 'webhook_id', { type: 'TEXT' });
    pgm.alterColumn('webhook_events', 'client_user_id', { type: 'TEXT' });

    // Step 3: Add a UNIQUE constraint on user_webhooks(webhook_id, client_user_id) for webhook_agent_links FK
    await pgm.addConstraint('user_webhooks', 'user_webhooks_webhook_id_client_user_id_key', {
        unique: ['webhook_id', 'client_user_id']
    });

    // Step 4: Re-add Foreign Key constraints with the new TEXT types
    await pgm.addConstraint('user_webhooks', 'user_webhooks_webhook_id_fkey', {
        foreignKeys: { columns: 'webhook_id', references: 'webhooks(id)', onDelete: 'CASCADE' }
    });
    await pgm.addConstraint('webhook_events', 'webhook_events_webhook_id_fkey', {
        foreignKeys: { columns: 'webhook_id', references: 'webhooks(id)', onDelete: 'CASCADE' }
    });
    await pgm.addConstraint('webhook_agent_links', 'webhook_agent_links_fk_user_webhook', {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id'], 
            references: 'user_webhooks(webhook_id, client_user_id)',
            onDelete: 'CASCADE',
        },
    });
    await pgm.addConstraint('webhook_events', 'webhook_events_fk_user_webhook', {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id', 'platform_user_id'], 
            references: 'user_webhooks(webhook_id, client_user_id, platform_user_id)',
            onDelete: 'CASCADE',
        },
    });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
    console.warn("DOWN MIGRATION: Attempting to revert column types from TEXT to UUID and restore Foreign Keys.");

    await pgm.dropConstraint('webhook_agent_links', 'webhook_agent_links_fk_user_webhook', { ifExists: true });
    await pgm.dropConstraint('webhook_events', 'webhook_events_fk_user_webhook', { ifExists: true });
    await pgm.dropConstraint('webhook_events', 'webhook_events_webhook_id_fkey', { ifExists: true });
    await pgm.dropConstraint('user_webhooks', 'user_webhooks_webhook_id_fkey', { ifExists: true });
    await pgm.dropConstraint('user_webhooks', 'user_webhooks_webhook_id_client_user_id_key', { ifExists: true });

    pgm.alterColumn('webhook_events', 'client_user_id', { type: 'UUID USING client_user_id::uuid' });
    pgm.alterColumn('webhook_events', 'webhook_id', { type: 'UUID USING webhook_id::uuid' });
    pgm.alterColumn('webhook_agent_links', 'client_user_id', { type: 'UUID USING client_user_id::uuid' });
    pgm.alterColumn('webhook_agent_links', 'webhook_id', { type: 'UUID USING webhook_id::uuid' });
    pgm.alterColumn('user_webhooks', 'client_user_id', { type: 'UUID USING client_user_id::uuid' });
    pgm.alterColumn('user_webhooks', 'webhook_id', { type: 'UUID USING webhook_id::uuid' });
    pgm.alterColumn('webhooks', 'id', { 
        type: 'UUID USING id::uuid',
        default: pgm.func('uuid_generate_v4()')
    });

    console.warn("Restoring original Foreign Key constraints for UUID types. These must match schema state before this specific migration.");
    await pgm.addConstraint('user_webhooks', 'user_webhooks_webhook_id_fkey', {
        foreignKeys: { columns: 'webhook_id', references: 'webhooks(id)', onDelete: 'CASCADE' }
    });
    await pgm.addConstraint('webhook_events', 'webhook_events_webhook_id_fkey', {
        foreignKeys: { columns: 'webhook_id', references: 'webhooks(id)', onDelete: 'CASCADE' }
    });
    await pgm.addConstraint('webhook_agent_links', 'webhook_agent_links_fk_user_webhook', {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id'], 
            references: 'user_webhooks(webhook_id, client_user_id)',
            onDelete: 'CASCADE',
        },
    });
     await pgm.addConstraint('webhook_events', 'webhook_events_fk_user_webhook', {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id', 'platform_user_id'], 
            references: 'user_webhooks(webhook_id, client_user_id, platform_user_id)',
            onDelete: 'CASCADE',
        },
    });
    console.info("Down migration attempted. Verify database schema and data integrity.");
}; 