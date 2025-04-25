import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto'; // Import crypto for key generation
import { ServiceResponse, ErrorResponse } from '@agent-base/types';
// Import routers
import webhookRoutes from './routes/webhookRoutes.js'; // Import the router and add .js
import { authMiddleware } from './middleware/auth.js'; // Keep if needed globally, remove if only on webhookRoutes
import { _getGsmSecretValueByName, _storeGsmSecretByName } from './lib/gsm.js'; // Import GSM helpers

dotenv.config();

// --- Configuration Store ---
// Simple in-memory config store, expand if needed
interface AppConfig {
    hmacKey: string | null;
}

const appConfig: AppConfig = {
    hmacKey: null, // Will be loaded asynchronously
};

// Export config for use in controllers/services
// Note: Ensure this is accessed only *after* initializeConfig completes
export { appConfig }; 

// --- Initialization Function ---
const HMAC_SECRET_NAME = 'webhook-identifier-hmac-key'; // GSM Secret ID

async function initializeConfig() {
    console.log('Initializing configuration...');
    const projectId = process.env.GOOGLE_PROJECT_ID;
    if (!projectId) {
        throw new Error("GOOGLE_PROJECT_ID environment variable is not set.");
    }
    const fullSecretName = `projects/${projectId}/secrets/${HMAC_SECRET_NAME}`;

    try {
        console.log(`Attempting to fetch HMAC key from GSM: ${HMAC_SECRET_NAME}`);
        let hmacKeyValue = await _getGsmSecretValueByName(fullSecretName);

        if (hmacKeyValue) {
            console.log('HMAC key found in GSM.');
            if (typeof hmacKeyValue !== 'string' || hmacKeyValue.length < 32) { // Basic validation
                 console.error('WARNING: Fetched HMAC key from GSM is invalid (not a string or too short). Generating a new one.');
                 hmacKeyValue = null; // Force regeneration
            }
        }

        if (!hmacKeyValue) {
            console.log('HMAC key not found or invalid in GSM. Generating and storing a new key...');
            // Generate a new 32-byte (256-bit) key, hex encoded
            const newKey = crypto.randomBytes(32).toString('hex');
            const stored = await _storeGsmSecretByName(HMAC_SECRET_NAME, newKey);
            if (stored) {
                console.log('Successfully stored new HMAC key in GSM.');
                hmacKeyValue = newKey;
            } else {
                // This shouldn't happen with current _storeGsmSecretByName logic unless exception occurs
                throw new Error('Failed to store newly generated HMAC key in GSM.');
            }
        }

        appConfig.hmacKey = hmacKeyValue as string; // Store the key
        console.log('HMAC key loaded successfully.');
        console.log('Configuration initialized successfully.');

    } catch (error) {
        console.error('FATAL ERROR during configuration initialization:', error);
        // Decide how to handle failure: exit, run with default (unsafe), etc.
        process.exit(1); // Exit if config fails
    }
}

// --- Application Setup ---
const app: Express = express();
const port = process.env.PORT || 3001;

// --- Middleware ---

// Enable JSON body parsing
app.use(express.json());

// Placeholder for authentication middleware (to extract ServiceCredentials)
// app.use(authMiddleware); 

// --- Routes ---

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', provider: 'webhook-store' });
});

// Mount webhook routes under /api/v1
app.use('/api/v1/webhooks', webhookRoutes);

// --- Error Handling ---

// Catch-all for unhandled routes (after defined routes)
app.use((req: Request, res: Response, next: NextFunction) => {
  const errorResponse: ErrorResponse = {
    success: false,
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} not found.`,
  };
  res.status(404).json(errorResponse);
});

// Global error handler
app.use((err: Error, req: Request, res: Response<ServiceResponse<never>>, next: NextFunction) => {
  console.error('Unhandled Error:', err.stack || err);

  // Avoid sending detailed errors in production
  const message = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message;
  const details = process.env.NODE_ENV === 'production' ? undefined : err.stack;

  const errorResponse: ErrorResponse = {
    success: false,
    error: err.name === 'ZodError' ? 'Validation Error' : 'Internal Server Error',
    message: message,
    details: details,
  };
  
  // Use appropriate status code (e.g., 400 for validation errors)
  const statusCode = err.name === 'ZodError' ? 400 : 500;
  res.status(statusCode).json(errorResponse);
});

// --- Server Start (after config initialization) ---

// Use an async IIFE to ensure config is loaded before starting the server
(async () => {
    await initializeConfig(); // Wait for config to load

    // Ensure HMAC key is loaded before starting
    if (!appConfig.hmacKey) {
         console.error("FATAL: HMAC Key not loaded. Server cannot start.");
         process.exit(1);
    }

    app.listen(port, () => {
        console.log(`[server]: Webhook Store server is running at http://localhost:${port}`);
    });
})();

export default app; // Export for potential testing 