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

const client = new SecretManagerServiceClient();
const PARENT = `projects/${projectId}`;

/**
 * Generates a GSM-compatible secret ID.
 * Format: <userType>_<userId>_<secretUtilityProvider>_<secretType>
 * Converts to lowercase.
 */
const generateSecretId = (
    userType: UserType,
    userId: string, 
    secretUtilityProvider: UtilityProvider, 
    secretType: UtilitySecretType
): string => {
    // Ensure all parts are strings and handle potential undefined/null - though types should prevent this
    const parts = [userType, userId, secretUtilityProvider, secretType].map(part => String(part));
    if (parts.some(part => !part || part === 'undefined' || part === 'null')) {
        throw new Error(`Invalid components for generating secret ID: ${parts.join('_')}`);
    }
    return parts.join('_').toLowerCase();
};

// --- Internal Helper Functions --- 

/**
 * Internal helper to get the latest version value of a secret by its full GSM name.
 * Does basic JSON parsing.
 * @param secretName Full GSM secret name (e.g., projects/PROJECT_ID/secrets/SECRET_ID)
 * @returns The parsed secret value or null if not found/empty/parse error.
 * @throws Error on unexpected GSM API errors.
 */
async function _getGsmSecretValueByName(secretName: string): Promise<string | null> {
    const nameWithVersion = `${secretName}/versions/latest`;
    try {
        const [version] = await client.accessSecretVersion({ name: nameWithVersion });
        if (!version.payload?.data) {
            console.warn(`Secret version ${nameWithVersion} found but has no data.`);
            return null;
        }
        const payload = version.payload.data.toString();
        return payload;
    } catch (error: any) {
        if (error.code === 5) { // NOT_FOUND
            console.log(`Secret ${nameWithVersion} not found.`);
            return null;
        }
        console.error(`Error getting secret ${nameWithVersion} from GSM:`, error);
        throw error; // Re-throw unexpected errors
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
async function _storeGsmSecretByName(secretId: string, secretValue: any): Promise<boolean> {
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
        return true;

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
            return true;
        } else {
            console.error(`Error storing secret ${secretId} in GSM:`, error);
            throw error; // Re-throw unexpected errors
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
    secretValue: string
): Promise<ServiceResponse<string>> {
    try {
        const secretId = generateSecretId(userType, userId, secretUtilityProvider, secretType);
        const secretName = `${PARENT}/secrets/${secretId}`;
        const valueToStore = String(secretValue); // Ensure string

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
    secretType: UtilitySecretType
): Promise<ServiceResponse<SecretExists>> {
    try {
        const secretId = generateSecretId(userType, userId, secretUtilityProvider, secretType);
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
    secretType: UtilitySecretType
): Promise<ServiceResponse<{ value: string | null }>> {
    try {
        const secretId = generateSecretId(userType, userId, secretUtilityProvider, secretType);
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