/**
 * Utilities for generating and handling secret identifiers specific to this application.
 */
import {
    UserType,
    UtilityProvider,
    UtilitySecretType,
} from '@agent-base/types';

/**
 * Generates a GSM-compatible secret ID based on application-specific parameters.
 * Format: <userType>_<userId>_<secretUtilityProvider>_<secretUtilitySubProvider>_<secretType>
 * Converts to lowercase and sanitizes characters.
 *
 * @param userType The type of user (e.g., platform, client).
 * @param userId The ID of the user.
 * @param secretUtilityProvider The provider the secret belongs to.
 * @param secretUtilitySubProvider A sub-identifier for the utility provider (e.g., a specific event or resource).
 * @param secretType The type of secret.
 * @returns A sanitized, GSM-compatible secret ID string, truncated to 255 characters.
 */
export const generateApplicationSecretId = (
    userType: UserType,
    userId: string, 
    secretUtilityProvider: UtilityProvider, 
    secretUtilitySubProvider: string,
    secretType: UtilitySecretType
): string => {
    const baseId = `${userType}_${userId}_${secretUtilityProvider}_${secretUtilitySubProvider}_${secretType}`;
    // Sanitize the ID: replace invalid characters (not alphanumeric, hyphen, or underscore) with a hyphen.
    const sanitizedId = baseId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    
    // Ensure the secret ID does not exceed 255 characters, as per GSM limits.
    return sanitizedId.substring(0, 255);
}; 