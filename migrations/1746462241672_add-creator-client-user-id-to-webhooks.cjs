/* eslint-disable @typescript-eslint/naming-convention */
// @ts-check

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import("node-pg-migrate/dist/types").MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.addColumn('webhooks', {
        creator_client_user_id: {
            type: 'varchar(255)',
            notNull: false, // Allow nulls initially
        }
    });
};

/**
 * @param {import("node-pg-migrate/dist/types").MigrationBuilder} pgm
 */
exports.down = (pgm) => {
    pgm.dropColumn('webhooks', 'creator_client_user_id');
}; 