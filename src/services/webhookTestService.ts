/**
 * Webhook Test Service
 *
 * Contains business logic for testing a webhook execution, including
 * retrieving secrets and sending a request to the target URL.
 */
import { getWebhookById } from './webhookDefinitionService.js';
import { getSecretGsm } from '../lib/gsm.js';
import { WebhookRecord } from '../types/db.js';
import { UserType, UtilitySecretType, UtilityProvider, Webhook, ErrorResponse, ServiceResponse } from '@agent-base/types';

/**
 * Helper function to set a value at a nested path within an object.
 * Example: setObjectValueAtPath(obj, 'a.b.c', 10) will set obj.a.b.c = 10
 * @param obj The object to modify.
 * @param path The dot-separated path string.
 * @param value The value to set.
 */
const setObjectValueAtPath = (obj: any, path: string, value: any): void => {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
};

export interface WebhookTestResult {
    request?: {
        targetUrl: string;
        method: string;
        headers: Record<string, string>;
        payload: any;
    };
    response?: {
        status: number;
        headers: Record<string, string>;
        body: any;
    };
    resolvedSecrets?: Record<string, boolean>; // Indicates which secrets were found e.g. { "API_KEY": true, "TOKEN": false }
}

/**
 * Tests a webhook by retrieving its definition, fetching necessary secrets,
 * constructing a payload, and sending an HTTP request to the target URL.
 *
 * @param webhookId The ID of the webhook definition to test.
 * @param clientUserId The ID of the client user initiating the test. This user must be the creator of the webhook.
 * @returns A promise resolving to a WebhookTestResult object.
 */
export const testWebhookExecution = async (
    webhookId: string,
    clientUserId: string,
): Promise<ServiceResponse<WebhookTestResult>> => {

    const webhook = await getWebhookById(webhookId);

    if (!webhook) {
        return {
            success: false,
            error: `Webhook with ID ${webhookId} not found.`,
        };
    }

    // Authorization: Ensure the user testing is the creator of the webhook definition
    if (webhook.creatorClientUserId !== clientUserId) {
        return {
            success: false,
            error: 'Unauthorized',
            details: 'Unauthorized: You are not the creator of this webhook definition.',
        };
    }

    const payload : Record<string, unknown> = webhook.eventPayloadSchema;
    const resolvedSecretsInfo: Record<string, boolean> = {};
    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

    if (webhook.clientUserIdentificationMapping) {
        for (const [secretKey, secretPath] of Object.entries(webhook.clientUserIdentificationMapping)) {
            const secretType = secretKey as UtilitySecretType;
            try {
                const secretResponse = await getSecretGsm(
                    'client' as UserType, // Assuming 'client' user type for clientUserId
                    clientUserId,
                    webhook.webhookProviderId as UtilityProvider, // Assuming webhook_provider_id is a UtilityProvider
                    webhook.subscribedEventId, // Assumption: using subscribed_event_id as secretUtilitySubProvider
                    secretType
                );

                if (secretResponse.success && secretResponse.data?.value) {
                    setObjectValueAtPath(payload, secretPath, secretResponse.data.value);
                    // Check if path indicates a header, e.g., "headers.Authorization"
                    if (secretPath.toLowerCase().startsWith('headers.')) {
                        const headerKey = secretPath.substring('headers.'.length);
                        requestHeaders[headerKey] = secretResponse.data.value;
                         // Remove from payload if it was only meant for headers
                        const pathParts = secretPath.split('.');
                        if (pathParts.length === 2 && pathParts[0].toLowerCase() === 'headers') {
                            delete payload.headers; // clean up if only 'headers' object was created for this
                        }

                    }
                    resolvedSecretsInfo[secretKey] = true;
                } else {
                    resolvedSecretsInfo[secretKey] = false;
                    console.warn(`Secret ${secretKey} for webhook ${webhookId} not found or has no value.`);
                    return {
                        success: false,
                        error: `Secret ${secretKey} for webhook ${webhookId} not found or has no value.`,
                        details: JSON.stringify(resolvedSecretsInfo),
                    };
                }
            } catch (secretError) {
                console.error(`Error fetching secret ${secretKey} for webhook ${webhookId}:`, secretError);
                resolvedSecretsInfo[secretKey] = false;
                // Potentially return an error result immediately
                return {
                    success: false,
                    error: `Error fetching secret ${secretKey}: ${secretError instanceof Error ? secretError.message : String(secretError)}`,
                    details: JSON.stringify(resolvedSecretsInfo),
                };
            }
        }
    }

    const requestDetails = {
        targetUrl: webhook.webhookUrl,
        method: 'POST', // Defaulting to POST, can be made configurable
        headers: requestHeaders,
        payload: payload
    };

    try {
        const response = await fetch(requestDetails.targetUrl, {
            method: requestDetails.method,
            headers: requestDetails.headers,
            body: Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined, // Send body only if payload is not empty
        });

        const responseBody = await response.text(); // Read as text first, then try to parse as JSON
        let parsedBody;
        try {
            parsedBody = JSON.parse(responseBody);
        } catch (e) {
            parsedBody = responseBody; // Keep as text if not valid JSON
        }
        
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        return {
            success: response.ok,
            details: `Webhook test ${response.ok ? 'succeeded' : 'failed'} with status ${response.status}.`,
            data: {
                request: requestDetails,
                response: {
                    status: response.status,
                    headers: responseHeaders,
                    body: parsedBody,
                },
                resolvedSecrets: resolvedSecretsInfo,
            } as WebhookTestResult,
        } as ServiceResponse<WebhookTestResult>;

    } catch (fetchError) {
        console.error(`Error sending test request to ${requestDetails.targetUrl} for webhook ${webhookId}:`, fetchError);
        return {
            success: false,
            error: `Failed to send HTTP request to target URL: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
            details: `Resolved secrets: ${JSON.stringify(resolvedSecretsInfo)}
            Request: ${JSON.stringify(requestDetails)}`,
        };
    }
}; 