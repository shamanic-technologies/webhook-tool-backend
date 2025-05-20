/**
 * PostgreSQL Database Connection Setup
 *
 * Initializes and exports a connection pool for interacting with the PostgreSQL database.
 * Also registers the pgvector type handler.
 */
import pg from 'pg';
import pgvector from 'pgvector/pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Validate that DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('FATAL ERROR: DATABASE_URL environment variable is not set.');
  process.exit(1); // Exit if the database URL is missing
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Add SSL configuration if needed for production environments
  // ssl: {
  //   rejectUnauthorized: false // Example for Heroku, adjust as needed
  // }
});

/**
 * Registers the vector type handler with the pg library.
 * This needs to be done after the pool is created but before the first query involving vectors.
 */
async function registerVectorType() {
  try {
    // Get a client from the pool to register the type
    const client = await pool.connect(); 
    try {
      await pgvector.registerType(client);
      console.log('pgvector type registered successfully.');
    } finally {
      // Ensure the client is released back to the pool
      client.release(); 
    }
  } catch (err) {
    console.error('Error registering pgvector type:', err);
    // Decide if this is a fatal error for your application
    // process.exit(1);
  }
}

// Register the type when the module loads
registerVectorType();

/**
 * Executes a SQL query using the connection pool.
 *
 * @param text The SQL query string (can include placeholders like $1, $2)
 * @param params An array of parameters to substitute into the query string
 * @returns A Promise resolving to the query result
 */
export const query = <T extends pg.QueryResultRow>(text: string, params?: any[]): Promise<pg.QueryResult<T>> => {
  return pool.query<T>(text, params);
};

/**
 * Exports the connection pool directly for more complex transactions if needed.
 */
export { pool }; 