/* eslint-disable @typescript-eslint/naming-convention */
'use strict';

// Define the table name consistently
const TABLE_NAME = 'user_webhooks'; // Confirmed table name
// Define the column name (snake_case for DB consistency)
const COLUMN_NAME = 'client_user_identification_hash';
// Define the index name
const INDEX_NAME = 'user_webhooks_webhook_id_client_user_id_hash_idx'; // Adjusted index name slightly

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
exports.up = async (pgm) => {
    // Add the new column
    pgm.addColumn(TABLE_NAME, {
        [COLUMN_NAME]: {
            type: 'VARCHAR(64)', // SHA-256 hash is 64 hex characters
            notNull: false // Initially allow nulls, will be populated when link is active
        }
    });

    // Add the index for efficient lookups
    // Use 'webhook_id' as the first part of the index as it's likely a primary filter
    pgm.addIndex(TABLE_NAME, ['webhook_id', COLUMN_NAME], {
        name: INDEX_NAME,
        // unique: false // Combination doesn't strictly need to be unique, though unlikely to collide
    });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
exports.down = async (pgm) => {
    // Drop the index first
    pgm.dropIndex(TABLE_NAME, ['webhook_id', COLUMN_NAME], { name: INDEX_NAME });

    // Drop the column
    pgm.dropColumn(TABLE_NAME, COLUMN_NAME);
};
