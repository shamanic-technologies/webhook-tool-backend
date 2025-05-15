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

Base URL: Most endpoints are prefixed with `/api/v1`. The incoming webhook endpoint has a different structure.

Authentication:
*   Most routes (all except `/health` and `/incoming/...`) require a dual authentication mechanism:
    1.  An `Authorization` header with a Bearer token:
        *   `Authorization: Bearer YOUR_WEBHOOK_TOOL_API_KEY` (This key comes from the `WEBHOOK_TOOL_API_KEY` environment variable of the service).
    2.  A set of `x-platform-*` headers:
        *   `x-platform-api-key`: Your API key (should be the same value as `YOUR_WEBHOOK_TOOL_API_KEY` used in the Bearer token).
        *   `x-platform-user-id`: The ID of the platform user.
        *   `x-client-user-id`: The ID of the client user. This service uses this ID to scope operations.
*   If required headers are missing or invalid, the service will typically respond with a `401 Unauthorized` or `403 Forbidden` error.
*   The `/health` endpoint requires no authentication.
*   The `/incoming/:webhookProviderId/:subscribedEventId/:clientUserId` endpoint uses a `secret` query parameter for authentication and does not use the Bearer token or `x-platform-*` headers.

---

**`GET /health`**

*   Checks the health of the service.
*   **Response:** `{"status":"ok","provider":"webhook-store"}`

**`POST /api/v1/webhooks`** (Create Webhook Definition)

*   Creates a new webhook configuration.
*   **Authentication:** Requires `Authorization: Bearer <WEBHOOK_TOOL_API_KEY>` and `x-platform-api-key`, `x-platform-user-id`, `x-client-user-id` headers.
*   **Body:** `WebhookData` (from `@agent-base/types`)
    *   Example:
        ```json
        {
            "name": "Crisp New Message",
            "description": "Handles new messages from Crisp chat",
            "webhookProviderId": "crisp",
            "subscribedEventId": "message:send",
            "conversationIdIdentificationMapping": "data.session_id",
            "creatorClientUserId": "YOUR_CLIENT_USER_ID_EXAMPLE"
        }
        ```
*   **Response:** `ServiceResponse<Webhook>`

**`POST /api/v1/webhooks/search`** (Search Webhook Definitions)

*   Searches for webhooks based on a query string. The search is performed only within the webhooks created by the `clientUserId` from the authentication context.
*   The vector embedding generation for semantic search is currently a placeholder.
*   **Authentication:** Requires `Authorization: Bearer <WEBHOOK_TOOL_API_KEY>` and `x-platform-api-key`, `x-platform-user-id`, `x-client-user-id` headers.
*   **Body:** `{ "query": string, "limit"?: number }`
*   **Response:** `ServiceResponse<SearchWebhookResult>`

**`POST /api/v1/webhooks/get-user-created`** (Get User-Created Webhook Definitions)

*   Fetches all webhook definitions created by the authenticated `clientUserId`.
*   **Authentication:** Requires `Authorization: Bearer <WEBHOOK_TOOL_API_KEY>` and `x-platform-api-key`, `x-platform-user-id`, `x-client-user-id` headers.
*   **Body:** None
*   **Response:** `ServiceResponse<SearchWebhookResult>`

**`POST /api/v1/webhooks/:webhookId/link-user`** (Link User to Webhook)

*   Links a specific client user to a webhook definition. Checks if setup (secrets/confirmation) is needed.
*   **Authentication:** Requires `Authorization: Bearer <WEBHOOK_TOOL_API_KEY>` and `x-platform-api-key`, `x-platform-user-id`, `x-client-user-id` headers.
*   **Params:** `:webhookId` (UUID)
*   **Body:** None
*   **Response:**
    *   If setup needed: `ServiceResponse<SetupNeeded>`
    *   If setup complete: `ServiceResponse<UserWebhook>` (Status 201 if new link, 200 if existing)

**`POST /api/v1/webhooks/:webhookId/link-agent`** (Link Agent to User-Webhook Link)

*   Links an agent to an existing, *active* user-webhook link.
*   **Authentication:** Requires `Authorization: Bearer <WEBHOOK_TOOL_API_KEY>` and `x-platform-api-key`, `x-platform-user-id`, `x-client-user-id` headers.
*   **Params:** `:webhookId` (UUID)
*   **Body:** `{ "agentId": string }` (agentId must be a valid UUID)
*   **Response:** `ServiceResponse<WebhookAgentLink>`

**`GET /api/v1/webhooks/:webhookId/events`** (Get Webhook Events)

*   Retrieves recorded webhook events for a specific webhook ID, scoped to the authenticated `clientUserId`.
*   **Authentication:** Requires `Authorization: Bearer <WEBHOOK_TOOL_API_KEY>` and `x-platform-api-key`, `x-platform-user-id`, `x-client-user-id` headers.
*   **Params:** `:webhookId` (UUID)
*   **Body:** None
*   **Response:** `ServiceResponse<WebhookEvent[]>`

**`POST /incoming/:webhookProviderId/:subscribedEventId/:clientUserId`** (Handle Incoming Webhook Event)

*   Endpoint where third-party services send webhook events.
*   **Authentication:** Uses a `secret` query parameter (e.g., `?secret=YOUR_UNIQUE_SECRET`). It does **not** use the `Authorization` Bearer token or `x-platform-*` headers.
*   **Params:**
    *   `:webhookProviderId`: Identifier of the webhook provider (e.g., "gmail").
    *   `:subscribedEventId`: Identifier of the specific event being sent (e.g., "new_email").
    *   `:clientUserId`: The client user ID this webhook event is intended for.
*   **Query Parameter:** `secret=YOUR_USER_WEBHOOK_SECRET` (mandatory for authentication)
*   **Body:** The raw incoming webhook payload from the third-party service (e.g., JSON payload from Crisp, Gmail, etc.).
    *   Example (Crisp):
        ```json
        {
            "data": {
                "session_id": "session_crisp_123",
                "website_id": "website_crisp_abc"
            },
            "event": "message:send"
        }
        ```
*   **Response:** `ServiceResponse<string>` (e.g., `{"success":true,"data":"Webhook resolved successfully"}`)

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

[MIT](LICENSE)