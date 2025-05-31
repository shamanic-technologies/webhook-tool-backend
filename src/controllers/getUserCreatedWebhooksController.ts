/**
 * Controller: Get User Created Webhooks
 * Fetches all webhook definitions created by the authenticated user.
 */
import { Response, NextFunction, Request } from 'express';
import { 
    Webhook, 
    ServiceResponse, 
    SuccessResponse,
    SearchWebhookResult
} from '@agent-base/types';
import { 
    getUserCreatedWebhooksService, 
} from '../services/webhookDefinitionService.js'; 
import { AuthenticatedRequest } from '../middleware/auth.js';

/**
 * Controller for POST /get-user-created-webhooks - Fetch webhooks created by the user.
 */
export const getUserCreatedWebhooksController = async (req: Request, res: Response<ServiceResponse<SearchWebhookResult>>, next: NextFunction) => {
    try {
        // clientUserId is guaranteed to be a string by authMiddleware.
        const clientUserId = (req as AuthenticatedRequest).humanInternalCredentials!.clientUserId!;
        const clientOrganizationId = (req as AuthenticatedRequest).humanInternalCredentials!.clientOrganizationId!;
        // Call the updated service function which now returns fully populated Webhook[]
        const webhooksApp = await getUserCreatedWebhooksService(clientUserId, clientOrganizationId); 
        
        // Prepare the success response
        const response: SuccessResponse<SearchWebhookResult> = { success: true, data: webhooksApp };
        res.status(200).json(response);

    } catch (error) {
        console.error('[Controller Error] Get User Private Webhooks:', error);
        next(error); // Pass errors to the global error handler
    }
}; 