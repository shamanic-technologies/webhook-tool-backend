'use strict';

const TABLE_NAME = 'webhooks';
const OLD_COLUMN_NAME = 'user_identification_mapping';
const NEW_CLIENT_COLUMN_NAME = 'client_user_identification_mapping';
const NEW_CONVO_COLUMN_NAME = 'conversation_id_identification_mapping';

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = async (pgm) => {
    // Add new columns
    pgm.addColumn(TABLE_NAME, {
        [NEW_CLIENT_COLUMN_NAME]: {
            type: 'jsonb',
            notNull: true,
            // Set a default, assuming existing rows might need one.
            // Default to empty object, adjust if needed.
            default: '{}'
        },
        [NEW_CONVO_COLUMN_NAME]: {
            type: 'text',
            notNull: true,
            // Set a default for existing rows.
            // Default to empty string, adjust if needed.
            default: '' 
        }
    });

    // Optional: Copy data from old column to new column(s) if applicable
    // This depends highly on how you want to handle existing data.
    // Example: Assuming old mapping only contained client mapping
    // pgm.sql(`UPDATE ${TABLE_NAME} SET ${NEW_CLIENT_COLUMN_NAME} = ${OLD_COLUMN_NAME}`);

    // Remove the old column
    pgm.dropColumn(TABLE_NAME, OLD_COLUMN_NAME);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = async (pgm) => {
    // Add the old column back
    pgm.addColumn(TABLE_NAME, {
        [OLD_COLUMN_NAME]: {
            type: 'jsonb',
            notNull: true,
            default: '{}' // Restore default
        }
    });

    // Optional: Copy data back from new column(s) to old column if needed
    // pgm.sql(`UPDATE ${TABLE_NAME} SET ${OLD_COLUMN_NAME} = ${NEW_CLIENT_COLUMN_NAME}`);

    // Remove the new columns
    pgm.dropColumn(TABLE_NAME, NEW_CONVO_COLUMN_NAME);
    pgm.dropColumn(TABLE_NAME, NEW_CLIENT_COLUMN_NAME);
};
