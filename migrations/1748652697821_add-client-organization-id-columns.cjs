/* eslint-disable @typescript-eslint/naming-convention */
// @ts-check

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate/dist/types').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    // Add creator_client_organization_id to webhooks table
    pgm.addColumn('webhooks', {
        creator_client_organization_id: {
            type: 'varchar(255)',
            notNull: false, // Set to true if it should be NOT NULL, and provide a default or handle existing rows
            // Example: defaultValue: pgm.func('') // Default to empty string if not null
        }
    });

    // Add client_organization_id to user_webhooks table
    pgm.addColumn('user_webhooks', {
        client_organization_id: {
            type: 'varchar(255)',
            notNull: false, // Set to true if it should be NOT NULL
        }
    });

    // Add client_organization_id to webhook_events table
    pgm.addColumn('webhook_events', {
        client_organization_id: {
            type: 'varchar(255)',
            notNull: false, // Set to true if it should be NOT NULL
        }
    });

    // Add client_organization_id to webhook_agent_links table
    pgm.addColumn('webhook_agent_links', {
        client_organization_id: {
            type: 'varchar(255)',
            notNull: false, // Set to true if it should be NOT NULL
        }
    });
};

/**
 * @param {import('node-pg-migrate/dist/types').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
    pgm.dropColumn('webhooks', 'creator_client_organization_id');
    pgm.dropColumn('user_webhooks', 'client_organization_id');
    pgm.dropColumn('webhook_events', 'client_organization_id');
    pgm.dropColumn('webhook_agent_links', 'client_organization_id');
};
