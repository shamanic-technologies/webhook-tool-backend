/**
 * Google Secret Manager Client Wrapper
 *
 * Provides functions to interact with Google Secret Manager for storing,
 * checking, and retrieving secrets, tailored for this application's needs.
 */
import { 
    CheckSecretRequest, 
    SecretExists, 
    GetSecretRequest, 
    SecretValue, 
    ServiceResponse, 
    StoreSecretRequest, 
    UserType, // Assuming UserType might be needed if adapting Check/Get requests
    ErrorResponse,
    UtilitySecretType,
    UtilityProvider,
} from '@agent-base/types';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import dotenv from 'dotenv';

dotenv.config();

// Ensure Google Project ID is set
const projectId = process.env.GOOGLE_PROJECT_ID;
if (!projectId) {
    console.error('FATAL ERROR: GOOGLE_PROJECT_ID environment variable is not set.');
    process.exit(1); // Exit if the project ID is missing
}

// --- Initialize Google Secret Manager Client ---
// Initialize client options, potentially including credentials from ENV
const clientOptions: { credentials?: object } = {};
if (process.env.GOOGLE_CREDENTIALS_JSON) {
  try {
    // Attempt to parse credentials from the environment variable
    clientOptions.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    console.log('Initializing GSM client with credentials from GOOGLE_CREDENTIALS_JSON.');
  } catch (error) {
    console.error('Failed to parse GOOGLE_CREDENTIALS_JSON. Falling back to default ADC.', error);
    // Fallback: If parsing fails, let the client use default ADC search order.
  }
}
// Create the client, passing options (which may include credentials)
const client = new SecretManagerServiceClient(clientOptions);
const PARENT = `projects/${projectId}`;

/**
 * Generates a GSM-compatible secret ID.
 * Format: <userType>_<userId>_<secretUtilityProvider>_<secretUtilitySubProvider>_<secretType>
 * Converts to lowercase.
 */
const generateSecretId = (
    userType: UserType,
    userId: string, 
    secretUtilityProvider: UtilityProvider, 
    secretUtilitySubProvider: string,
    secretType: UtilitySecretType
): string => {
    const baseId = `${userType}_${userId}_${secretUtilityProvider}_${secretUtilitySubProvider}_${secretType}`;
    // Sanitize the ID: replace invalid characters with a hyphen and convert to lowercase.
    // Allowed characters are letters, numerals, hyphens, and underscores.
    const sanitizedId = baseId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    
    // Ensure the secret ID does not exceed 255 characters.
    return sanitizedId.substring(0, 255);
};

// --- Internal Helper Functions --- 

/**
 * Internal helper to get the latest version value of a secret by its full GSM name.
 * Handles potential double-stringification by attempting JSON.parse.
 * @param secretName Full GSM secret name (e.g., projects/PROJECT_ID/secrets/SECRET_ID)
 * @returns The parsed secret value or null if not found/empty/parse error.
 * @throws Error on unexpected GSM API errors.
 */
async function _getGsmSecretValueByName(secretName: string): Promise<ServiceResponse<SecretValue>> {
    const nameWithVersion = `${secretName}/versions/latest`;
    try {
        const [version] = await client.accessSecretVersion({ name: nameWithVersion });
        if (!version.payload?.data) {
            console.warn(`Secret version ${nameWithVersion} found but has no data.`);
            return { success: true, data: { value: null } };
        }

        // Directly return the string representation of the payload
        const payloadString = version.payload.data.toString();
        return { success: true, data: { value: payloadString } };

    } catch (error: any) {
        if (error.code === 5) { // NOT_FOUND
            console.log(`Secret ${nameWithVersion} not found.`);
            return { success: true, data: { value: null } };
        }
        console.error(`Error getting secret ${nameWithVersion} from GSM:`, error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error getting secret from GSM' };
    }
}

/**
 * Internal helper to store a secret value by its GSM secret ID.
 * Creates the secret if it doesn't exist.
 * @param secretId The short ID of the secret (e.g., webhook-identifier-hmac-key).
 * @param secretValue The value to store (will be JSON stringified unless already string).
 * @returns True on success, false on failure.
 * @throws Error on unexpected GSM API errors.
 */
async function _storeGsmSecretByName(secretId: string, secretValue: any): Promise<ServiceResponse<string>> {
    const secretName = `${PARENT}/secrets/${secretId}`;
    // Ensure the value is a string before storing
    const valueToStore = String(secretValue); 

    try {
        // Check if secret exists
        await client.getSecret({ name: secretName });

        // If exists, add a new version
        await client.addSecretVersion({
            parent: secretName,
            payload: { data: Buffer.from(valueToStore) }, // Store raw string buffer
        });
        console.log(`Stored new version for secret: ${secretId}`);
        return { success: true, data: 'Secret version added successfully' };

    } catch (error: any) {
        if (error.code === 5) { // NOT_FOUND
            // Secret doesn't exist, create it
            console.log(`Secret ${secretId} not found, creating...`);
            await client.createSecret({
                parent: PARENT,
                secretId,
                secret: { replication: { automatic: {} } },
            });
            // Add the first version
            await client.addSecretVersion({
                parent: secretName,
                payload: { data: Buffer.from(valueToStore) }, // Store raw string buffer
            });
            console.log(`Created secret ${secretId} and stored initial version.`);
            return { success: true, data: 'Secret version added successfully' };
        } else {
            console.error(`Error storing secret ${secretId} in GSM:`, error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error storing secret in GSM' };
        }
    }
}

// Export helpers for use in startup script
export { _getGsmSecretValueByName, _storeGsmSecretByName };

/**
 * Stores a secret in Google Secret Manager.
 * Creates the secret if it doesn't exist, otherwise adds a new version.
 *
 * @param userType The type of user (e.g., platform, client).
 * @param userId The ID of the user.
 * @param secretUtilityProvider The provider the secret belongs to.
 * @param secretType The type of secret.
 * @param secretValue The value of the secret to store (will be JSON stringified).
 * @returns ServiceResponse indicating success or failure.
 */
export async function storeSecretGsm(
    userType: UserType, 
    userId: string, 
    secretUtilityProvider: UtilityProvider,
    secretType: UtilitySecretType, 
    secretUtilitySubProvider: string,
    secretValue: string
): Promise<ServiceResponse<string>> {
    try {
        const secretId = generateSecretId(userType, userId, secretUtilityProvider, secretUtilitySubProvider, secretType);
        const secretName = `${PARENT}/secrets/${secretId}`;
        const valueToStore = secretValue; 

        try {
            // Check if secret exists
            await client.getSecret({ name: secretName });

            // If exists, add a new version
            await client.addSecretVersion({
                parent: secretName,
                payload: {
                    data: Buffer.from(valueToStore), // Store raw string buffer
                },
            });
            return { success: true, data: 'Secret version added successfully' };

        } catch (error: any) {
            if (error.code === 5) { // NOT_FOUND
                // Secret doesn't exist, create it
                await client.createSecret({
                    parent: PARENT,
                    secretId,
                    secret: {
                        replication: { automatic: {} },
                    },
                });
                // Add the first version
                await client.addSecretVersion({
                    parent: secretName,
                    payload: {
                        data: Buffer.from(valueToStore), // Store raw string buffer
                    },
                });
                return { success: true, data: 'Secret created successfully' };
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error('Error storing secret in GSM:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error storing secret in GSM' };
    }
}

/**
 * Checks if a specific secret exists for a user in Google Secret Manager.
 *
 * @param userType The type of user.
 * @param userId The ID of the user.
 * @param secretUtilityProvider The provider the secret belongs to.
 * @param secretType The type of secret.
 * @returns ServiceResponse containing boolean indicating existence.
 */
export async function checkSecretExistsGsm(
    userType: UserType, 
    userId: string, 
    secretUtilityProvider: UtilityProvider, 
    secretUtilitySubProvider: string,
    secretType: UtilitySecretType
): Promise<ServiceResponse<SecretExists>> {
    try {
        const secretId = generateSecretId(userType, userId, secretUtilityProvider, secretUtilitySubProvider, secretType);
        const name = `${PARENT}/secrets/${secretId}`;

        try {
            await client.getSecret({ name });
            return { success: true, data: { exists: true } };
        } catch (error: any) {
            if (error.code === 5) { // NOT_FOUND
                return { success: true, data: { exists: false } };
            }
            throw error;
        }
    } catch (error) {
        console.error('Error checking secret existence in GSM:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error checking secret existence in GSM' };
    }
}

/**
 * Retrieves the latest version of a secret for a user from Google Secret Manager.
 *
 * @param userType The type of user.
 * @param userId The ID of the user.
 * @param secretUtilityProvider The provider the secret belongs to.
 * @param secretType The type of secret.
 * @returns ServiceResponse containing the secret value (parsed from JSON) or null if not found/empty.
 */
export async function getSecretGsm(
    userType: UserType, 
    userId: string, 
    secretUtilityProvider: UtilityProvider,
    secretUtilitySubProvider: string,
    secretType: UtilitySecretType
): Promise<ServiceResponse<SecretValue>> {
    try {
        const secretId = generateSecretId(userType, userId, secretUtilityProvider, secretUtilitySubProvider, secretType);
        const name = `${PARENT}/secrets/${secretId}/versions/latest`;
        console.log(`DEBUG: getSecretGsm - Attempting to fetch secret version: ${name}`);
        try {
            const [version] = await client.accessSecretVersion({ name });

            if (!version.payload?.data) {
                console.log(`DEBUG: getSecretGsm - Secret version ${name} found but has NO DATA.`);
                console.warn(`Secret version ${name} found but has no data.`);
                return { success: true, data: { value: null } };
            }

            const payload = version.payload.data.toString();
            console.log(`DEBUG: getSecretGsm - Secret version ${name} has PAYLOAD: "${payload}" (Type: ${typeof payload})`);
            return { success: true, data: { value: payload } }; 
            
        } catch (error: any) {
            if (error.code === 5) {
                 console.log(`DEBUG: getSecretGsm - Secret version ${name} NOT FOUND (Error code 5).`);
            } else {
                 console.error(`DEBUG: getSecretGsm - Error fetching secret version ${name}:`, error);
            }
            if (error.code === 5) { // NOT_FOUND
                console.log(`Secret ${name} not found.`);
                return { success: true, data: { value: null } };
            }
            throw error;
        }
    } catch (error) {
        console.error('Error getting secret from GSM:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error getting secret from GSM' };
    }
} 