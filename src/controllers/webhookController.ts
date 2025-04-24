/**
 * Webhook API Controllers
 *
 * Contains route handler functions for the webhook-related endpoints.
 */
import { Response, NextFunction } from 'express';
import {
    Webhook,
    ServiceResponse,
    SuccessResponse,
    ErrorResponse,
    UserType,
    WebhookStatus,
    UtilitySecretType,
    UtilityProvider,
    UserWebhook,
    WebhookAgentLink,
    WebhookSetupNeeded,
    UtilityInputSecret,
    UtilityActionConfirmation
} from '@agent-base/types';
import {
    createWebhook as createWebhookService,
    getWebhookById as getWebhookByIdService,
    searchWebhooks as searchWebhooksService,
    mapWebhookRecordToWebhook,
} from '../services/webhookDefinitionService.js';
import {
    createUserWebhook as createUserWebhookService,
    updateUserWebhookStatus as updateUserWebhookStatusService,
    findUserWebhook as findUserWebhookService,
    mapUserWebhookRecordToUserWebhook,
} from '../services/userWebhookLinkService.js';
import {
    linkAgentToWebhook as linkAgentToWebhookService,
    mapWebhookAgentLinkRecordToWebhookAgentLink,
} from '../services/agentWebhookLinkService.js';
import { checkSecretExistsGsm, getSecretGsm } from '../lib/gsm.js';
import {
    CreateWebhookSchema,
    SearchWebhookSchema,
    WebhookIdParamsSchema,
    LinkAgentSchema,
    ValidatedRequestBody
} from '../lib/schemas.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { ZodError } from 'zod';
import { validate as uuidValidate } from 'uuid'; // Import the validate function

// Placeholder for embedding generation
async function generateEmbedding(text: string): Promise<number[]> {
    console.warn('generateEmbedding is a placeholder and does not generate real embeddings.');
    const vector = Array(10).fill(0);
    for (let i = 0; i < text.length && i < 10; i++) {
        vector[i] = text.charCodeAt(i) / 255.0;
    }
    return vector;
}

// Format Zod validation errors
const formatValidationError = (error: ZodError): ErrorResponse => {
    const details = error.errors.map(e => `${e.path.join('.')} - ${e.message}`).join('; ');
    return {
        success: false,
        error: 'Validation Error',
        message: 'Invalid request input.',
        details: details
    };
};

/**
 * Controller for POST / - Create a new webhook definition.
 */
export const createWebhookController = async (req: AuthenticatedRequest, res: Response<ServiceResponse<Webhook>>, next: NextFunction) => {
    try {
        const validationResult = CreateWebhookSchema.safeParse(req.body);
        if (!validationResult.success) {
            return res.status(400).json(formatValidationError(validationResult.error));
        }
        // Cast validated data to align with WebhookData types where enums were strings
        const webhookData = {
            ...validationResult.data,
            // Cast string back to UtilityProvider enum/type (assuming string matches enum value)
            webhookProviderId: validationResult.data.webhookProviderId as UtilityProvider,
            // Cast string array back to UtilitySecretType[] (assuming strings match enum values)
            requiredSecrets: validationResult.data.requiredSecrets as UtilitySecretType[],
            // Cast keys back? This is tricky. Assume mapping keys are handled correctly by service/DB.
             userIdentificationMapping: validationResult.data.userIdentificationMapping as Record<UtilitySecretType, string>,
        };

        // Validate input consistency (userIdentificationMapping vs requiredSecrets)
        for (const secretType of webhookData.requiredSecrets) {
            const mappedField = webhookData.userIdentificationMapping[secretType];
            if (!mappedField) {
                 return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: `Secret '${secretType}' is required but not found in userIdentificationMapping.`,
                });
            }
        }
        
        const embedding = await generateEmbedding(`${webhookData.name} ${webhookData.description}`);
        const newWebhookRecord = await createWebhookService(webhookData, embedding);
        const webhookApp = mapWebhookRecordToWebhook(newWebhookRecord);
        const response: SuccessResponse<Webhook> = { success: true, data: webhookApp };
        res.status(201).json(response);

    } catch (error) {
        console.error('[Controller Error] Create Webhook:', error);
        next(error);
    }
};

/**
 * Controller for POST /search - Search for webhooks.
 */
export const searchWebhooksController = async (req: AuthenticatedRequest, res: Response<ServiceResponse<Webhook[]>>, next: NextFunction) => {
    try {
        const validationResult = SearchWebhookSchema.safeParse(req.body);
        if (!validationResult.success) {
            return res.status(400).json(formatValidationError(validationResult.error));
        }
        const { query: searchQuery, limit } = validationResult.data;
        const queryVector = await generateEmbedding(searchQuery);
        const results = await searchWebhooksService(queryVector, limit);
        const webhooksApp = results.map(mapWebhookRecordToWebhook);
        const response: SuccessResponse<Webhook[]> = { success: true, data: webhooksApp };
        res.status(200).json(response);

    } catch (error) {
        console.error('[Controller Error] Search Webhooks:', error);
        next(error);
    }
};

/**
 * Controller for POST /:webhookId/link-user - Link a webhook to a client user.
 */
// Update response type to include WebhookSetupNeeded in the union
export const linkUserController = async (
    req: AuthenticatedRequest, 
    res: Response<ServiceResponse<UserWebhook | WebhookSetupNeeded>>, 
    next: NextFunction
) => {
    // ---- Add log here ----
    console.log(`>>> Entering linkUserController for webhookId: ${req.params?.webhookId}, clientUserId: ${req.serviceCredentials?.clientUserId}`);
    // ---------------------
    try {
        const paramsValidation = WebhookIdParamsSchema.safeParse(req.params);
        if (!paramsValidation.success) {
            return res.status(400).json(formatValidationError(paramsValidation.error));
        }
        const { webhookId } = paramsValidation.data;

        const clientUserId = req.serviceCredentials?.clientUserId;
        if (!clientUserId) {
            return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Client User ID header is required.' });
        }
        const platformUserId = req.serviceCredentials?.platformUserId;
         if (!platformUserId) {
            return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Platform User ID missing.' });
        }

        const webhookRecord = await getWebhookByIdService(webhookId);
        if (!webhookRecord) {
            return res.status(404).json({ success: false, error: 'Not Found', message: 'Webhook not found.' });
        }
        const webhook = mapWebhookRecordToWebhook(webhookRecord);
        console.log('DEBUG: Webhook:', JSON.stringify(webhook));

        let userWebhookRecord = await findUserWebhookService(webhookId, clientUserId);
        console.log('DEBUG: User Webhook Record:', JSON.stringify(userWebhookRecord));
        
        // Define the structure for setup actions based on SetupNeeded type
        // Separate lists for different types of setup actions
        let missingInputs: UtilityInputSecret[] = [];
        let missingConfirmations: UtilityActionConfirmation[] = [];
        
        let currentStatus = userWebhookRecord?.status ?? WebhookStatus.PENDING;
        const isNewLink = !userWebhookRecord;
        console.log('DEBUG: Is New Link:', isNewLink);
        if (isNewLink) {
             userWebhookRecord = await createUserWebhookService(webhookId, clientUserId, WebhookStatus.PENDING);
        }

        const webhookUrlToInput = `${process.env.WEBHOOK_URL || 'YOUR_BASE_WEBHOOK_URL'}/${webhook.webhookProviderId}/${webhook.subscribedEventId}`;
        // const confirmationSecretType = 'action_confirmation'; // Use string value for type
        const confirmationSecretDbType = UtilityActionConfirmation.WEBHOOK_URL_INPUTED; // Type used for DB/GSM lookup
        console.log('DEBUG: Confirmation Secret DB Type:', confirmationSecretDbType);
        // Check confirmation secret
        const confirmationCheck = await getSecretGsm(UserType.Client, clientUserId, webhook.webhookProviderId, confirmationSecretDbType);
        console.log('DEBUG: Confirmation Check:', JSON.stringify(confirmationCheck));
        let isConfirmed = false;
        if (confirmationCheck.success &&confirmationCheck.data.value === 'true') {
            isConfirmed = true;
        }
        
        if (!isConfirmed) {
            // Add the specific confirmation enum value to the list
            missingConfirmations.push(UtilityActionConfirmation.WEBHOOK_URL_INPUTED);
            // We might still want to keep the description for the overall message, but not directly in the array
            // Consider adding details to the message/title/description fields of SetupNeeded later
        }
        console.log('DEBUG: Missing Confirmations:', missingConfirmations);
        console.log('DEBUG: Required Secrets:', webhook.requiredSecrets);
        // Check other required secrets
        for (const secretType of webhook.requiredSecrets) {
            // Skip the explicit confirmation secret type, handled above
            // Ensure comparison is with the enum value
            if (secretType === UtilityActionConfirmation.WEBHOOK_URL_INPUTED) {
                continue;
            }

            const gsmCheck = await checkSecretExistsGsm(UserType.Client, clientUserId, webhook.webhookProviderId, secretType);
            console.log('DEBUG: GSM Check:', JSON.stringify(gsmCheck));
            if (!gsmCheck.success) {
                 console.error(`GSM check failed for ${secretType}: ${gsmCheck.error}`);
                 // Decide how to handle GSM check failures - potentially add to a separate error list or message
                 // For now, we might need to signal an error state or add a generic message
                 // Pushing the enum value might not be appropriate if the check *failed* vs secret *not existing*
                 // Let's skip adding to missingInputs for now if the check itself failed, but log it.
                 // Consider adding a specific error message to the final SetupNeeded object.
                 continue; 
            }

            if (!gsmCheck.data.exists) {
                 // Add the specific secret enum value to the list
                 // Ensure secretType is actually a UtilityInputSecret before pushing
                 // We might need a type guard or check, but given the context, 
                 // requiredSecrets *should* contain UtilityInputSecret types here.
                 // Assuming secretType is a valid UtilityInputSecret enum member
                 if (Object.values(UtilityInputSecret).includes(secretType as UtilityInputSecret)) {
                    missingInputs.push(secretType as UtilityInputSecret);
                 } else {
                    console.warn(`Secret type '${secretType}' is required but not a recognized UtilityInputSecret enum member.`);
                    // Handle unexpected secret types if necessary
                 }
            }
        }

        // Determine response based on setup actions
        // Check if either list has items
        if (missingInputs.length > 0 || missingConfirmations.length > 0) {
            if (currentStatus === WebhookStatus.ACTIVE) {
                userWebhookRecord = await updateUserWebhookStatusService(webhookId, clientUserId, WebhookStatus.PENDING);
                currentStatus = WebhookStatus.PENDING;
            }
            console.log('DEBUG: Current Status:', currentStatus);
            // Construct the WebhookSetupNeeded object correctly
            const setupNeededData: WebhookSetupNeeded = {
                needsSetup: true, // Set to literal true
                title: `Webhook Setup Required for ${webhook.name}`,
                message: `Additional setup is needed to activate the ${webhook.webhookProviderId} webhook.`,
                description: `Please provide the missing secrets and/or confirm actions listed below. The webhook URL to configure in the provider is: ${webhookUrlToInput}`,
                webhookProviderId: webhook.webhookProviderId,
                webhookUrlToInput: webhookUrlToInput, // Keep this top-level field for now
                // Add the arrays if they are not empty
                ...(missingInputs.length > 0 && { requiredSecretInputs: missingInputs }),
                ...(missingConfirmations.length > 0 && { requiredActionConfirmations: missingConfirmations })
            };
            console.log('DEBUG: Setup Needed Data:', JSON.stringify(setupNeededData));
            // Return SuccessResponse<WebhookSetupNeeded>
            const response: SuccessResponse<WebhookSetupNeeded> = {
                success: true, 
                data: setupNeededData
            };
            // Explicitly cast to the overall expected response type union
            return res.status(200).json(response);

        } else {
            // All secrets/confirmations exist. Activate if PENDING.
            if (currentStatus === WebhookStatus.PENDING) {
                 userWebhookRecord = await updateUserWebhookStatusService(webhookId, clientUserId, WebhookStatus.ACTIVE);
            }

            // ---- START DEBUG LOGS ----
            console.log('DEBUG: Record before mapping:', JSON.stringify(userWebhookRecord)); 
            console.log('DEBUG: Type of created_at before mapping:', typeof userWebhookRecord?.created_at);
            // ---- END DEBUG LOGS ----

            // Return SuccessResponse<UserWebhook>
            const userWebhook = mapUserWebhookRecordToUserWebhook(userWebhookRecord!); // Non-null assertion used!
            
            // ---- START DEBUG LOGS ----
            console.log('DEBUG: Mapped object:', JSON.stringify(userWebhook)); 
            // ---- END DEBUG LOGS ----
            
            const response: SuccessResponse<UserWebhook> = { success: true, data: userWebhook };
            // Explicitly cast to the overall expected response type union
            return res.status(isNewLink ? 201 : 200).json(response as ServiceResponse<UserWebhook | WebhookSetupNeeded>);
        }

    } catch (error) {
        console.error('[Controller Error] Link User:', error);
        next(error);
    }
};

/**
 * Controller for POST /:webhookId/link-agent - Link a webhook to an agent.
 */
export const linkAgentController = async (req: AuthenticatedRequest, res: Response<ServiceResponse<WebhookAgentLink>>, next: NextFunction) => {
    try {
        const paramsValidation = WebhookIdParamsSchema.safeParse(req.params);
        if (!paramsValidation.success) {
            return res.status(400).json(formatValidationError(paramsValidation.error));
        }
        const { webhookId } = paramsValidation.data;

        const bodyValidation = LinkAgentSchema.safeParse(req.body);
        if (!bodyValidation.success) {
             return res.status(400).json(formatValidationError(bodyValidation.error));
        }
        const { agentId } = bodyValidation.data;

        // --- Add UUID validation for agentId using the uuid library ---
        if (!uuidValidate(agentId)) { // Use uuid's validate function
            console.error(`[Controller Error] Link Agent: Invalid agentId format: ${agentId}`);
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                message: 'Invalid agentId format.',
                details: 'The provided agentId does not match the expected UUID format (e.g., xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).'
            });
        }
        // --- End UUID validation ---

        const clientUserId = req.serviceCredentials?.clientUserId;
        if (!clientUserId) {
            return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Client User ID header is required.' });
        }

        const userWebhookRecord = await findUserWebhookService(webhookId, clientUserId);
        if (!userWebhookRecord) {
             return res.status(404).json({ success: false, error: 'Not Found', message: 'User is not linked to this webhook.' });
        }
        if (userWebhookRecord.status !== WebhookStatus.ACTIVE) {
             return res.status(400).json({ success: false, error: 'Bad Request', message: 'Webhook link for user is not active. Cannot link agent.' });
        }

        const agentLinkRecord = await linkAgentToWebhookService(webhookId, clientUserId, agentId);
        const agentLink = mapWebhookAgentLinkRecordToWebhookAgentLink(agentLinkRecord);
        const response: SuccessResponse<WebhookAgentLink> = { success: true, data: agentLink };
        res.status(201).json(response);

    } catch (error) {
        console.error('[Controller Error] Link Agent:', error);
        next(error);
    }
}; 