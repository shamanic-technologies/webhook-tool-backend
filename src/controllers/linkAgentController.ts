/**
 * Controller: Link Agent to User Webhook
 */
import { Response, NextFunction } from 'express';
import { 
    WebhookAgentLink, 
    ServiceResponse, 
    SuccessResponse, 
    WebhookStatus 
} from '@agent-base/types';
import { 
    linkAgentToWebhook as linkAgentToWebhookService,
    mapWebhookAgentLinkRecordToWebhookAgentLink,
} from '../services/agentWebhookLinkService.js';
import { findUserWebhook as findUserWebhookService } from '../services/userWebhookLinkService.js';
import { WebhookIdParamsSchema, LinkAgentSchema } from '../lib/schemas.js';
import { formatValidationError } from '../lib/validationUtils.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { validate as uuidValidate } from 'uuid';

/**
 * Controller for POST /:webhookId/link-agent - Link a webhook to an agent.
 */
export const linkAgentController = async (req: AuthenticatedRequest, res: Response<ServiceResponse<WebhookAgentLink>>, next: NextFunction) => {
    console.log('>>> Entering linkAgentController');
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

        if (!uuidValidate(agentId)) {
            console.error(`[Controller Error] Link Agent: Invalid agentId format: ${agentId}`);
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                message: 'Invalid agentId format.',
                details: 'The provided agentId does not match the expected UUID format.'
            });
        }

        const clientUserId = req.serviceCredentials?.clientUserId;
        if (!clientUserId) {
            return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Client User ID header is required.' });
        }
        // Also get platformUserId
        const platformUserId = req.serviceCredentials?.platformUserId;
        if (!platformUserId) {
            // Add check for platformUserId as it's needed for the service
             return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Platform User ID header is required.' });
        }

        // Ensure user webhook link exists and is active first
        const userWebhookRecord = await findUserWebhookService(webhookId, clientUserId);
        if (!userWebhookRecord) {
             return res.status(404).json({ success: false, error: 'Not Found', message: 'User is not linked to this webhook.' });
        }
        if (userWebhookRecord.status !== WebhookStatus.ACTIVE) {
             return res.status(400).json({ success: false, error: 'Bad Request', message: 'Webhook link for user is not active. Cannot link agent.' });
        }

        // Pass platformUserId to the service function
        const agentLinkRecord = await linkAgentToWebhookService(webhookId, clientUserId, platformUserId, agentId);
        const agentLink = mapWebhookAgentLinkRecordToWebhookAgentLink(agentLinkRecord);
        const response: SuccessResponse<WebhookAgentLink> = { success: true, data: agentLink };
        console.log('DEBUG: Link Agent Response:', JSON.stringify(response));
        res.status(201).json(response);

    } catch (error) {
        console.error('[Controller Error] Link Agent:', error);
        next(error);
    }
}; 