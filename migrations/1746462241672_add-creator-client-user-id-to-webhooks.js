/* eslint-disable @typescript-eslint/naming-convention */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * @param {import("node-pg-migrate/dist/types").MigrationBuilder} pgm
 */
export const up = (pgm) => {
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
export const down = (pgm) => {
    pgm.dropColumn('webhooks', 'creator_client_user_id');
};
