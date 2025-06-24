import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto'; // Import crypto for key generation
import fs from 'fs'; // Added for writing temp credentials file
import path from 'path'; // Added for constructing temp file path
// import { ServiceResponse, ErrorResponse, SecretValue } from '@agent-base/types'; // SecretValue might still be needed for type hints if not directly from client
import { ErrorResponse } from '@agent-base/types'; // Keep if used for error responses
// Import routers
import webhookRoutes from './routes/webhookRoutes.js'; // Import the router and add .js
// import { authMiddleware } from './middleware/auth.js'; // Keep if needed globally, remove if only on webhookRoutes
// import { apiKeyAuth } from './middleware/apiKeyAuth.js'; // Import the new API key middleware
// import { _getGsmSecretValueByName, _storeGsmSecretByName } from './lib/gsm.js'; // Removed
import { GoogleSecretManager } from '@agent-base/secret-client';

dotenv.config(); 

// --- Configuration Store ---
interface AppConfig {
    hmacKey: string | null;
    // Potentially export gsmClient if needed elsewhere, or pass it down
}

const appConfig: AppConfig = {
    hmacKey: null,
};

// Export config for use in controllers/services
export { appConfig }; 

// --- GSM Client (to be initialized) ---
// This can be exported if other parts of the application need direct access
// Or, individual functions can be exposed that use this client.
export let gsmClient: GoogleSecretManager;

// --- Initialization Function ---
const HMAC_SECRET_NAME = 'webhook-identifier-hmac-key'; // GSM Secret ID for the application's HMAC key

async function prepareGcpCredentials() {
    const credsContent = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credsContent && credsContent.trim().startsWith('{')) {
        console.log('GOOGLE_APPLICATION_CREDENTIALS appears to be JSON content. Writing to temporary file...');
        try {
            // Ensure /tmp directory exists or choose a writable location
            // In many container environments, /tmp is writable.
            const tempDir = '/tmp';
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const tempCredPath = path.join(tempDir, 'gcp_creds.json');
            fs.writeFileSync(tempCredPath, credsContent);
            process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredPath; // Override env var for this process
            console.log(`Credentials written to ${tempCredPath} and GOOGLE_APPLICATION_CREDENTIALS updated.`);
        } catch (error) {
            console.error('FATAL ERROR: Failed to write GOOGLE_APPLICATION_CREDENTIALS content to temporary file:', error);
            process.exit(1);
        }
    } else if (credsContent) {
        console.log('GOOGLE_APPLICATION_CREDENTIALS appears to be a file path. Using as is.');
    } else {
        console.warn('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. Attempting to use Application Default Credentials.');
    }
}

async function initializeConfig() {
    console.log('Initializing configuration...');
    await prepareGcpCredentials(); // Prepare credentials before initializing client

    const projectId = process.env.GOOGLE_PROJECT_ID;
    if (!projectId) {
        console.error("FATAL ERROR: GOOGLE_PROJECT_ID environment variable is not set.");
        process.exit(1);
    }

    try {
        gsmClient = new GoogleSecretManager({
            projectId: projectId,
            // Credentials will be picked up from the (potentially overridden) GOOGLE_APPLICATION_CREDENTIALS env var
        });
    } catch (error) {
        console.error('FATAL ERROR: Could not initialize GoogleSecretManager:', error);
        process.exit(1);
    }

    try {
        let hmacKey = await gsmClient.getSecret(HMAC_SECRET_NAME);

        if (!hmacKey) {
            console.log(`HMAC key '${HMAC_SECRET_NAME}' not found or empty in GSM. Generating and storing a new key...`);
            const newKey = crypto.randomBytes(32).toString('hex');
            try {
                await gsmClient.storeSecret(HMAC_SECRET_NAME, newKey);
                console.log(`Successfully stored new HMAC key '${HMAC_SECRET_NAME}'.`);
                hmacKey = newKey;
            } catch (storeError) {
                console.error(`FATAL ERROR: Failed to store newly generated HMAC key '${HMAC_SECRET_NAME}' in GSM.`, storeError);
                process.exit(1);
            }
        }
        appConfig.hmacKey = hmacKey;
        console.log(`HMAC key '${HMAC_SECRET_NAME}' loaded successfully.`);

    } catch (error: any) {
        // Generic error handling for HMAC key retrieval
        let errorMessage = 'FATAL ERROR during HMAC key retrieval from GSM.';
        if (error && typeof error === 'object' && 'message' in error) {
            errorMessage += ` Message: ${error.message}`;
        }
        // Attempt to log original error if available, common in wrapped errors
        if (error && typeof error === 'object' && 'originalError' in error && error.originalError) {
            errorMessage += ` Original Error: ${error.originalError}`;
        }
        console.error(errorMessage, error); // Log the full error object for more details
        process.exit(1); 
    }
}

// --- Application Setup ---
const app: Express = express();
const port = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors()); // Enable CORS for all routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Routes ---
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', provider: 'webhook-tool' });
});

app.use('/api/v1/webhooks', webhookRoutes);

// --- Error Handling ---
app.use((req: Request, res: Response, next: NextFunction) => {
  const errorResponse: ErrorResponse = {
    success: false,
    error: 'Not Found',
    details: `Endpoint ${req.method} ${req.path} not found.`,
    hint: "Please check the API documentation for available endpoints and correct request paths."
  };
  res.status(404).json(errorResponse);
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Error:', err.stack || err);
  const errorMessage = process.env.NODE_ENV === 'production' ? 'An unexpected internal error occurred.' : err.message;
  const errorStack = process.env.NODE_ENV === 'production' ? undefined : err.stack;

  const errorResponse: ErrorResponse = {
    success: false,
    error: err.name === 'ZodError' ? 'Validation Error' : 'Internal Server Error',
    details: errorStack ? `${errorMessage} Stack: ${errorStack}` : errorMessage,
    hint: "An unexpected error occurred. If this persists, please check server logs or contact support. For validation errors, ensure your request payload matches the expected schema."
  };
  
  const statusCode = err.name === 'ZodError' ? 400 : 500;
  res.status(statusCode).json(errorResponse);
});

// --- Server Start (after config initialization) ---
(async () => {
    try {
        await initializeConfig(); 
        if (!appConfig.hmacKey) {
             console.error("FATAL: HMAC Key not loaded after initialization. Server cannot start.");
             process.exit(1);
        }
        app.listen(port, () => {
            console.log(`[server]: Webhook Tool server is running at http://localhost:${port}`);
        });
    } catch (initError: any) { // Explicitly type initError
        // This catch block might be redundant if initializeConfig already process.exit(1) on all its failure paths.
        // However, it's a good safety net for any unhandled promise rejection from initializeConfig itself.
        console.error("FATAL: Unhandled exception during server initialization process.", initError);
        process.exit(1);
    }
})();

export default app; 