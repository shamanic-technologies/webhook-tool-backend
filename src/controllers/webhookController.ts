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
    WebhookAgentLink
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
// The response is either a success with UserWebhook or an ErrorResponse
export const linkUserController = async (
    req: AuthenticatedRequest, 
    res: Response<ServiceResponse<UserWebhook>>, // Response is only UserWebhook on success
    next: NextFunction
) => {
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

        let userWebhookRecord = await findUserWebhookService(webhookId, clientUserId);
        let needsSetupDetails: string[] = []; // Collect setup details as strings
        let currentStatus = userWebhookRecord?.status ?? WebhookStatus.PENDING;
        const isNewLink = !userWebhookRecord;

        if (isNewLink) {
             userWebhookRecord = await createUserWebhookService(webhookId, clientUserId, WebhookStatus.PENDING);
        }

        const webhookUrlToInput = `${process.env.WEBHOOK_URL || 'YOUR_BASE_WEBHOOK_URL'}/${webhook.webhookProviderId}/${webhook.subscribedEventId}`;

        // Always require WEBHOOK_URL_INPUTED confirmation
        // Check if this confirmation is already stored in GSM (as boolean true)
        const confirmationSecretType = 'WEBHOOK_URL_INPUTED' as UtilitySecretType; // Cast needed
        const confirmationCheck = await getSecretGsm(UserType.Client, clientUserId, webhook.webhookProviderId, confirmationSecretType);
        let isConfirmed = false;
        // Check success AND that the value is specifically boolean true
        if (confirmationCheck.success && typeof confirmationCheck.data.value === 'boolean' && confirmationCheck.data.value === true) {
            isConfirmed = true;
        }
        
        if (!isConfirmed) {
            needsSetupDetails.push(
                `Confirmation needed: Please confirm you have configured the webhook URL in the ${webhook.webhookProviderId} provider dashboard: ${webhookUrlToInput} (Store boolean secret '${confirmationSecretType}' as true via secret store endpoint)`
            );
        }
        

        for (const secretType of webhook.requiredSecrets) {
            // Skip the explicit confirmation secret type, handled above
            if (secretType === confirmationSecretType) {
                continue;
            }

            const gsmCheck = await checkSecretExistsGsm(UserType.Client, clientUserId, webhook.webhookProviderId, secretType);
            
            if (!gsmCheck.success) {
                 console.error(`GSM check failed for ${secretType}: ${gsmCheck.error}`);
                 needsSetupDetails.push(`Failed to check required secret: ${secretType}. Error: ${gsmCheck.error}`);
                 continue;
            }

            if (!gsmCheck.data.exists) {
                 needsSetupDetails.push(`Missing required secret: ${secretType}. Please store this secret.`);
            }
        }

        if (needsSetupDetails.length > 0) {
            if (currentStatus === WebhookStatus.ACTIVE) {
                userWebhookRecord = await updateUserWebhookStatusService(webhookId, clientUserId, WebhookStatus.PENDING);
                currentStatus = WebhookStatus.PENDING;
            }

            // Return a standard ErrorResponse with setup details
            const errorResponse: ErrorResponse = {
                success: false,
                error: 'Setup Needed',
                message: 'Webhook requires configuration or confirmation before activation.',
                details: needsSetupDetails.join('\n') // Join details into a string
            };
            // 200 OK status but error in payload indicating action needed
            return res.status(200).json(errorResponse); 

        } else {
            // All secrets/confirmations exist. Activate if PENDING.
            if (currentStatus === WebhookStatus.PENDING) {
                 userWebhookRecord = await updateUserWebhookStatusService(webhookId, clientUserId, WebhookStatus.ACTIVE);
            }

            const userWebhook = mapUserWebhookRecordToUserWebhook(userWebhookRecord!);
            const response: SuccessResponse<UserWebhook> = { success: true, data: userWebhook };
            return res.status(isNewLink ? 201 : 200).json(response);
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