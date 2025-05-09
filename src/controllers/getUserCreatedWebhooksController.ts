/**
 * Controller: Get User Created Webhooks
 * Fetches all webhook definitions created by the authenticated user.
 */
import { Response, NextFunction } from 'express';
import { 
    Webhook, 
    ServiceResponse, 
    SuccessResponse 
} from '@agent-base/types';
import { 
    getUserCreatedWebhooksService, 
    mapWebhookRecordToWebhook 
} from '../services/webhookDefinitionService.js'; 
import { AuthenticatedRequest } from '../middleware/auth.js';

/**
 * Controller for POST /get-user-created-webhooks - Fetch webhooks created by the user.
 */
export const getUserCreatedWebhooksController = async (req: AuthenticatedRequest, res: Response<ServiceResponse<Webhook[]>>, next: NextFunction) => {
    console.log('>>> Entering getUserCreatedWebhooksController');
    try {
        // clientUserId is guaranteed to be a string by authMiddleware.
        const clientUserId = req.serviceCredentials!.clientUserId!;

        // Call the updated service function which now returns fully populated Webhook[]
        const webhooksApp = await getUserCreatedWebhooksService(clientUserId); 
        
        // The mapping is now done within the service, no need for: 
        // const webhooksApp = results.map(mapWebhookRecordToWebhook);
        
        // Prepare the success response
        const response: SuccessResponse<Webhook[]> = { success: true, data: webhooksApp };
        console.log('DEBUG: Get User Private Webhooks Response:', JSON.stringify(response));
        res.status(200).json(response);

    } catch (error) {
        console.error('[Controller Error] Get User Private Webhooks:', error);
        next(error); // Pass errors to the global error handler
    }
}; 