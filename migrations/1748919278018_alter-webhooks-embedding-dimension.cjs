/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-var-requires */
const { PgLiteral } = require('node-pg-migrate');

exports.shorthands = {
  embeddingColumn: {
    type: 'vector(1536)', // New dimension
    // If you were using a custom collation or another option, specify it here.
    // For pgvector, typically just the dimension is needed for ALTER.
  },
  oldEmbeddingColumn: {
    type: 'vector(10)', // Old dimension for rollback
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.alterColumn('webhooks', 'embedding', {
    type: 'vector(1536)',
    // pgvector doesn't use traditional collations or USING for type change if only dimension changes
    // and the base type remains 'vector'.
    // If there was data, a USING clause might be needed for type conversion,
    // but since the DB is empty, this is simpler.
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.alterColumn('webhooks', 'embedding', {
    type: 'vector(10)', // Revert to old dimension
  });
};
