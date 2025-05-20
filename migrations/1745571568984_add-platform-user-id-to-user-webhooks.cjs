'use strict';

const USER_WEBHOOKS_TABLE = 'user_webhooks';
const AGENT_LINKS_TABLE = 'webhook_agent_links';
const COLUMN_NAME = 'platform_user_id';
const USER_WEBHOOKS_PKEY = 'user_webhooks_pkey';
const AGENT_LINKS_FKEY = 'webhook_agent_links_fk_user_webhook';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
    // 1. Drop dependent foreign key first
    pgm.dropConstraint(AGENT_LINKS_TABLE, AGENT_LINKS_FKEY);

    // 2. Drop old primary key
    pgm.dropConstraint(USER_WEBHOOKS_TABLE, USER_WEBHOOKS_PKEY);

    // 3. Add column to user_webhooks
    pgm.addColumn(USER_WEBHOOKS_TABLE, {
        [COLUMN_NAME]: {
            type: 'varchar(255)',
            notNull: true,
            default: 'TEMP_PLATFORM_USER' // Temporary default
        }
    });
    pgm.alterColumn(USER_WEBHOOKS_TABLE, COLUMN_NAME, { default: null });

    // 4. Add column to webhook_agent_links
    pgm.addColumn(AGENT_LINKS_TABLE, {
        [COLUMN_NAME]: {
            type: 'varchar(255)',
            notNull: true,
            default: 'TEMP_PLATFORM_USER' // Temporary default
        }
    });
    pgm.alterColumn(AGENT_LINKS_TABLE, COLUMN_NAME, { default: null });

    // 5. Add new primary key to user_webhooks
    pgm.addConstraint(USER_WEBHOOKS_TABLE, USER_WEBHOOKS_PKEY, {
        primaryKey: ['webhook_id', 'client_user_id', COLUMN_NAME],
    });

    // 6. Add new foreign key referencing new PK
    pgm.addConstraint(AGENT_LINKS_TABLE, AGENT_LINKS_FKEY, {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id', COLUMN_NAME],
            references: `${USER_WEBHOOKS_TABLE}(webhook_id, client_user_id, ${COLUMN_NAME})`,
            onDelete: 'CASCADE',
        },
    });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
    // Reverse order for down migration
    // 1. Drop new FK constraint from webhook_agent_links
    pgm.dropConstraint(AGENT_LINKS_TABLE, AGENT_LINKS_FKEY);
    
    // 2. Drop new PK from user_webhooks
    pgm.dropConstraint(USER_WEBHOOKS_TABLE, USER_WEBHOOKS_PKEY);

    // 3. Drop column from webhook_agent_links
    pgm.dropColumn(AGENT_LINKS_TABLE, COLUMN_NAME);
    
    // 4. Drop column from user_webhooks
    pgm.dropColumn(USER_WEBHOOKS_TABLE, COLUMN_NAME);

    // 5. Add old PK back
    pgm.addConstraint(USER_WEBHOOKS_TABLE, USER_WEBHOOKS_PKEY, {
        primaryKey: ['webhook_id', 'client_user_id'],
    });
    
    // 6. Add old FK back (referencing old PK)
    pgm.addConstraint(AGENT_LINKS_TABLE, AGENT_LINKS_FKEY, {
        foreignKeys: {
            columns: ['webhook_id', 'client_user_id'],
            references: `${USER_WEBHOOKS_TABLE}(webhook_id, client_user_id)`,
            onDelete: 'CASCADE',
        },
    });
};
