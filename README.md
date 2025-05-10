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

Base URL: `/api/v1/webhooks` (except for `/health`)

Authentication:
*   All routes (except `/health`) require authentication via specific HTTP headers.
*   The following headers **must** be included in your requests:
    *   `x-platform-api-key`: Your platform API key.
    *   `x-platform-user-id`: The ID of the platform user.
    *   `x-client-user-id`: The ID of the client user. This service uses this ID to scope operations like search and webhook creation to the specific client user.
*   If any of these headers are missing, the service will respond with a `401 Unauthorized` error.
*   The `/health` endpoint requires no authentication.

---

**`GET /health`**

*   Checks the health of the service.
*   **Response:** `{"status":"ok","provider":"webhook-store"}`

**`POST /api/v1/webhooks`** (Create Webhook Definition)

*   Creates a new webhook configuration.
*   **Headers:**
    *   `x-platform-api-key: YOUR_PLATFORM_API_KEY`
    *   `x-platform-user-id: YOUR_PLATFORM_USER_ID`
    *   `x-client-user-id: YOUR_CLIENT_USER_ID`
*   **Body:** `WebhookData` (from `@agent-base/types`)
    *   Example:
        ```json
        {
            "name": "Test Crisp Events",
            "description": "Test handler for Crisp messages",
            "webhookProviderId": "crisp",
            "subscribedEventId": "evt_test_crisp_123",
            "requiredSecrets": ["CRISP_API_IDENTIFIER", "CRISP_API_KEY"],
            "clientUserIdentificationMapping": { "CRISP_API_IDENTIFIER": "data.website_id" },
            "conversationIdIdentificationMapping": "data.session_id",
            "eventPayloadSchema": { "type": "object" }
        }
        ```
*   **Response:** `ServiceResponse<Webhook>`

**`POST /api/v1/webhooks/search`** (Search Webhook Definitions)

*   Searches for webhooks based on a query string. The search is performed only within the webhooks created by the `clientUserId` provided in the `x-client-user-id` authentication header.
*   The vector embedding generation for semantic search is currently a placeholder.
*   **Headers:**
    *   `x-platform-api-key: YOUR_PLATFORM_API_KEY`
    *   `x-platform-user-id: YOUR_PLATFORM_USER_ID`
    *   `x-client-user-id: YOUR_CLIENT_USER_ID`
*   **Body:** `{ "query": string, "limit"?: number }`
*   **Response:** `ServiceResponse<Webhook[]>`
    *   Each `Webhook` object in the response array will include the standard webhook definition fields, plus:
        *   `webhookUrl: string` - The full dynamically constructed URL for this webhook (e.g., `YOUR_WEBHOOK_URL/providerId/subscribedEventId`).
        *   `isLinkedToCurrentUser?: boolean` - True if this webhook definition has an active or pending link to the `clientUserId` that made the search request.
        *   `linkedAgentId?: string` - If `isLinkedToCurrentUser` is true and an agent is linked to that user-webhook association, this field will contain the `agentId`.

**`POST /api/v1/webhooks/:webhookId/link-user`** (Link User to Webhook)

*   Links a specific client user to a webhook definition. Checks if setup (secrets/confirmation) is needed.
*   **Headers:**
    *   `x-platform-api-key: YOUR_PLATFORM_API_KEY`
    *   `x-platform-user-id: YOUR_PLATFORM_USER_ID`
    *   `x-client-user-id: YOUR_CLIENT_USER_ID`
*   **Params:** `:webhookId` (UUID)
*   **Body:** None
*   **Response:** 
    *   If setup needed: `ServiceResponse<SetupNeeded>` 
    *   If setup complete: `ServiceResponse<UserWebhook>` (Status 201 if new link, 200 if existing)

**`POST /api/v1/webhooks/:webhookId/link-agent`** (Link Agent to User-Webhook Link)

*   Links an agent to an existing, *active* user-webhook link.
*   **Headers:**
    *   `x-platform-api-key: YOUR_PLATFORM_API_KEY`
    *   `x-platform-user-id: YOUR_PLATFORM_USER_ID`
    *   `x-client-user-id: YOUR_CLIENT_USER_ID`
*   **Params:** `:webhookId` (UUID)
*   **Body:** `{ "agentId": string }` (agentId must be a valid UUID)
*   **Response:** `ServiceResponse<WebhookAgentLink>`

**`POST /api/v1/webhooks/:webhookId/test`** (Test Webhook Execution)

*   Tests the execution flow for a given webhook, simulating an incoming event and checking if it resolves to an agent and extracts necessary information. This is useful for verifying configuration and secret setup.
*   **Headers:**
    *   `x-platform-api-key: YOUR_PLATFORM_API_KEY`
    *   `x-platform-user-id: YOUR_PLATFORM_USER_ID`
    *   `x-client-user-id: YOUR_CLIENT_USER_ID`
*   **Params:** `:webhookId` (UUID)
*   **Body:** None
*   **Response:** `ServiceResponse<WebhookTestResult>`
    *   `WebhookTestResult` contains details about the test execution, including whether it was successful, any errors encountered, and resolved identifiers.

**`POST /api/v1/webhooks/resolve/:webhookProviderId/:subscribedEventId`** (Resolve Incoming Webhook)

*   Used internally by a gateway to find the linked agent(s) for an incoming webhook event.
*   **Headers:**
    *   `x-platform-api-key: YOUR_PLATFORM_API_KEY`
    *   `x-platform-user-id: YOUR_PLATFORM_USER_ID`
    *   `x-client-user-id: YOUR_CLIENT_USER_ID` (Note: The service will use this to identify the client context for resolving the webhook)
*   **Params:** `:webhookProviderId`, `:subscribedEventId`
*   **Body:** The raw incoming webhook payload (e.g., from Crisp, Gmail, etc.)
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
*   **Response:** `ServiceResponse<ResolvedWebhookData>` (Includes `clientUserId`, `platformUserId`, `agentId`, `conversationId`)

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

[MIT](LICENSE)