# webhook-store

A microservice using Express, TypeScript, PostgreSQL, and pgvector to store webhook definitions, manage user/agent links, and handle secret validation via Google Secret Manager.

This service is designed to work with the `@agent-base/types` and `@agent-base/api-client` packages.

## Features

*   Stores webhook configurations (provider, event, required secrets, payload schema).
*   Links webhooks to client users and agents.
*   Validates required secrets against Google Secret Manager before activating user links.
*   Provides a search endpoint using pgvector for semantic webhook lookup (embedding generation is currently a placeholder).
*   Uses `node-pg-migrate` for database schema management.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url> # Replace with your repository URL
    cd webhook-store
    ```

2.  **Install dependencies:**
    ```bash
    # Using pnpm (recommended)
    pnpm install
    ```

3.  **Environment Variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   **IMPORTANT:** You need to manually create the `.env.example` file if it doesn't exist (the assistant might have been blocked from creating it). Its content should be:
        ```dotenv
        # PostgreSQL connection string
        # Example: postgresql://user:password@host:port/database?sslmode=require
        DATABASE_URL=

        # Google Cloud Project ID (for Secret Manager)
        GOOGLE_PROJECT_ID=

        # Public base URL where webhook providers will send events to this service
        # Example: https://your-service-domain.com/api/incoming-webhooks
        # The final webhook URL given to the user will be WEBHOOK_URL/<webhookProviderId>/<subscribedEventId>
        WEBHOOK_URL=

        # Port for the Express server (defaults to 3001)
        PORT=3001
        ```
    *   Fill in the required variables in your `.env` file.

4.  **Database Setup (Local Development):**
    *   Ensure PostgreSQL (v14+ recommended for pgvector) is installed and running.
    *   Connect to PostgreSQL as a **superuser** (e.g., your local user if using Homebrew, or `postgres`). You might need to specify the default database:
        ```bash
        # Example for Homebrew user
        psql -U your_macos_username -d postgres 
        ```
    *   Run the following SQL commands (replace `your_secure_password`): 
        ```sql
        -- Create database
        CREATE DATABASE webhook_store_db;
        -- Create user
        CREATE USER webhook_store_user WITH PASSWORD 'your_secure_password';
        -- Grant privileges
        GRANT ALL PRIVILEGES ON DATABASE webhook_store_db TO webhook_store_user;
        -- Connect to the new database
        \c webhook_store_db
        -- Enable pgvector extension (Requires pgvector installed for PostgreSQL)
        CREATE EXTENSION IF NOT EXISTS vector;
        -- Exit psql
        \q
        ```
        *Note: If `CREATE EXTENSION` fails, you need to install the `pgvector` extension for your PostgreSQL version (e.g., `brew install pgvector` on macOS, ensuring it links correctly).* 
    *   Update the `DATABASE_URL` in your `.env` file with the user, password, and database name you just created.

5.  **Run Database Migrations:**
    ```bash
    pnpm run migrate:up
    ```
    This applies the schema defined in the `migrations/` folder.

## Development

*   **Run the development server (with hot-reloading):**
    ```bash
    pnpm dev
    ```
    The server will typically run on `http://localhost:3001` (or the `PORT` specified in `.env`).

*   **Build for production:**
    ```bash
    pnpm build
    ```

*   **Start the production server:**
    ```bash
    node dist/index.js 
    # or 
    # pnpm start 
    ```

*   **Linting & Formatting:**
    ```bash
    pnpm lint
    pnpm format
    ```

*   **Database Migrations:**
    *   Create a new migration: `pnpm run migrate:create <migration_name>`
    *   Apply migrations: `pnpm run migrate:up`
    *   Rollback last migration: `pnpm run migrate:down -- 1`

## API Endpoints

Base URL: `/api/v1/webhooks`

Authentication: Requires `x-platform-api-key` and `x-platform-user-id` headers on all requests. Some endpoints also require `x-client-user-id`.

*   **`POST /`** (Create Webhook)
    *   **Body:** `WebhookData` (from `@agent-base/types`)
    *   **Response:** `ServiceResponse<Webhook>`
*   **`POST /search`** (Search Webhooks)
    *   **Body:** `{ query: string, limit?: number }`
    *   **Response:** `ServiceResponse<Webhook[]>` (Note: Uses placeholder embedding generation)
*   **`POST /:webhookId/link-user`** (Link Webhook to User)
    *   Requires `x-client-user-id` header.
    *   **Params:** `webhookId` (UUID)
    *   **Body:** None
    *   **Response:** `ServiceResponse<UserWebhook>` on success, or an `ErrorResponse` with `error: 'Setup Needed'` if secrets/confirmation are missing.
*   **`POST /:webhookId/link-agent`** (Link Webhook to Agent)
    *   Requires `x-client-user-id` header.
    *   **Params:** `webhookId` (UUID)
    *   **Body:** `{ agentId: string }`
    *   **Response:** `ServiceResponse<WebhookAgentLink>`

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

(Add more detailed contribution guidelines as needed)

## License

[MIT](LICENSE)