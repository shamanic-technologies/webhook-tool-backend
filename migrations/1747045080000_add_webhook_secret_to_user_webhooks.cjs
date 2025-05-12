'use strict';

const TABLE_NAME = 'user_webhooks';
const COLUMN_NAME = 'webhook_secret';
const INDEX_NAME = 'idx_user_webhooks_webhook_secret'; // Index for faster lookups on the secret

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
exports.up = async (pgm) => {
    pgm.addColumn(TABLE_NAME, {
        [COLUMN_NAME]: {
            type: 'TEXT', // TEXT is suitable for UUIDs or other long random strings
            notNull: false, // Initially allow nulls. Application logic will populate this.
            comment: 'Unique secret generated for each user-webhook link, appended to the callback URL for secure identification. Populated by the application when a link becomes active or is created.'
        }
    });

    // Add an index for efficient lookups using the webhook_secret,
    // as this will be a key part of the new resolution mechanism.
    pgm.addIndex(TABLE_NAME, [COLUMN_NAME], {
        name: INDEX_NAME
    });

    // Comment on the old column to mark it for future removal
    const thisMigrationTimestamp = '1747045080000';
    pgm.sql(`COMMENT ON COLUMN "${TABLE_NAME}"."client_user_identification_hash" IS 'DEPRECATED: This column is planned for removal. Use webhook_secret instead. See migration ${thisMigrationTimestamp}_add_webhook_secret_to_user_webhooks.cjs.'`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
exports.down = async (pgm) => {
    // Revert comment on the old column
    pgm.sql(`COMMENT ON COLUMN "${TABLE_NAME}"."client_user_identification_hash" IS NULL`);

    pgm.dropIndex(TABLE_NAME, [COLUMN_NAME], { name: INDEX_NAME });
    pgm.dropColumn(TABLE_NAME, COLUMN_NAME);
}; 