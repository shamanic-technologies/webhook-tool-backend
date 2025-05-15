/**
 * Controller: Link Agent to User Webhook
 */
import { Response, NextFunction, Request } from 'express';
import { 
    AgentUserWebhook, 
    ServiceResponse, 
    SuccessResponse, 
    WebhookStatus 
} from '@agent-base/types';
import { 
    linkAgentToWebhook as linkAgentToWebhookService,
} from '../services/agentWebhookLinkService.js';
import { findUserWebhook as findUserWebhookService } from '../services/userWebhookLinkService.js';
import { WebhookIdParamsSchema, LinkAgentSchema } from '../lib/schemas.js';
import { formatValidationError } from '../lib/validationUtils.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { validate as uuidValidate } from 'uuid';

/**
 * Controller for POST /:webhookId/link-agent - Link a webhook to an agent.
 */
export const linkAgentController = async (req: Request, res: Response<ServiceResponse<AgentUserWebhook>>, next: NextFunction) => {
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
                error: 'Invalid agentId format.',
                details: 'The provided agentId does not match the expected UUID format.'
            });
        }

        const clientUserId = (req as AuthenticatedRequest).serviceCredentials?.clientUserId;
        if (!clientUserId) {
            return res.status(401).json({ success: false, error: 'Unauthorized', details: 'Client User ID header is required.' });
        }
        // Also get platformUserId
        const platformUserId = (req as AuthenticatedRequest).serviceCredentials?.platformUserId;
        if (!platformUserId) {
            // Add check for platformUserId as it's needed for the service
             return res.status(401).json({ success: false, error: 'Unauthorized', details: 'Platform User ID header is required.' });
        }

        // Ensure user webhook link exists and is active first
        const userWebhookRecord = await findUserWebhookService(webhookId, clientUserId);
        if (!userWebhookRecord) {
             return res.status(404).json({ success: false, error: 'Not Found', details: 'User is not linked to this webhook.' });
        }
        if (userWebhookRecord.status !== WebhookStatus.ACTIVE) {
             return res.status(400).json({ success: false, error: 'Bad Request', details: 'Webhook link for user is not active. Cannot link agent.' });
        }

        // Pass platformUserId to the service function
        const agentLink = await linkAgentToWebhookService(webhookId, clientUserId, platformUserId, agentId);
        const response: SuccessResponse<AgentUserWebhook> = {
            success: true,
            data: agentLink,
            hint: `Now you can test the webhook by calling the curl command and ask the user to check the sidebar on the left of the dashboard to confirm that he sees the event. If he sees the event, the webhook is working.
            If he sees the event with success then you are all set.
            If he sees the event with an error message then ask them to paste that message to you.
            If he doestnot see the event, it might be that:
            - The webhook url has not been properly inputed in the provider dashboard
            - The subscribed event has not been properly turned on for the specific webhook in the provider dashboard
            - An internal error: in that case contact the support`
        };
        console.log('DEBUG: Link Agent Response:', JSON.stringify(response));
        res.status(201).json(response);

    } catch (error) {
        console.error('[Controller Error] Link Agent:', error);
        next(error);
    }
}; 