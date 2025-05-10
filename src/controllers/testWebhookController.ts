/**
 * Webhook Test Controller
 *
 * Handles incoming API requests for testing a webhook.
 */
import { Request, Response, NextFunction } from 'express';
import { testWebhookExecution } from '../services/webhookTestService.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { ServiceResponse, ErrorResponse, WebhookTestResult } from '@agent-base/types';

/**
 * Controller function to handle testing a webhook.
 * Expects webhookId in params.
 * Requires authentication, clientUserId is derived from req.user.
 */
export const testWebhookController = async (req: Request, res: Response, next: NextFunction) => {
    const { webhookId } = req.params;

    const clientUserId = (req as AuthenticatedRequest).serviceCredentials.clientUserId;

    if (!webhookId) {
        return res.status(400).json({ success: false, error: 'Webhook ID is required in path parameters.' } as ErrorResponse);
    }

    try {
        const result: ServiceResponse<WebhookTestResult> = await testWebhookExecution(webhookId, clientUserId);
        
        if (!result.success) {
            if (result.error === 'Unauthorized') { 
                return res.status(403).json(result); 
            }
            if (result.error?.includes('not found')) {
                return res.status(404).json(result);
            }
            return res.status(500).json(result); 
        }
        
        return res.status(200).json(result); 
    } catch (error) {
        console.error(`Unhandled error in testWebhookController for webhook ${webhookId}:`, error);
        // Pass to the generic error handler
        next(error);
    }
}; 