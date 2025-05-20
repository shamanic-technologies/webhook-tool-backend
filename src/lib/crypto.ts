import * as crypto from 'crypto';
import { UtilitySecretType } from '@agent-base/types'; // Assuming UtilitySecretType is the key type

/**
 * Computes the HMAC-SHA256 hash for webhook identifiers.
 *
 * This function ensures consistency by sorting the keys of the identifiers
 * and converting all values to strings before creating a stable JSON representation
 * for hashing.
 *
 * @param identifiers - An object containing the key-value pairs for identification. Keys should typically be UtilitySecretType.
 * @param secretKey - The secret key for HMAC computation. Must be securely managed.
 * @returns The hex-encoded HMAC-SHA256 hash.
 * @throws Error if the secretKey is missing.
 */
export function computeIdentifierHash(
    identifiers: Record<string, string | number | boolean | null | undefined>,
    secretKey: string
): string {
    if (!secretKey) {
        throw new Error("HMAC secret key is missing.");
    }

    // Create a new object to store normalized identifiers
    const normalizedIdentifiers: Record<string, string> = {};

    // Ensure consistent ordering by sorting keys and normalize values
    const sortedKeys = Object.keys(identifiers).sort();
    for (const key of sortedKeys) {
        const value = identifiers[key];
        // Convert all defined values to string for consistent hashing
        // Exclude null/undefined or handle them explicitly if needed
        if (value !== null && value !== undefined) {
            normalizedIdentifiers[key] = String(value);
        } else {
            // Decide how to handle null/undefined. Option 1: Exclude (as done here)
            // Option 2: Include as a specific string like "__NULL__" or "__UNDEFINED__"
            // Option 3: Throw an error if null/undefined identifiers are not allowed
            console.warn(`Identifier key '${key}' has null or undefined value and will be excluded from hash.`);
        }
    }

    // Create a stable JSON string representation
    const dataToHash = JSON.stringify(normalizedIdentifiers);

    // Compute the HMAC-SHA256 hash
    return crypto.createHmac('sha256', secretKey)
                 .update(dataToHash)
                 .digest('hex');
} 