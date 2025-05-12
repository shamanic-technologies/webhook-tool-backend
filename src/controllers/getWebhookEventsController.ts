/**
 * Controller for retrieving webhook events for a specific webhook.
 */
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js'; // Corrected import path
import { ServiceResponse, ErrorResponse, WebhookEvent } from '@agent-base/types';
import { getWebhookEventsService } from '../services/getWebhookEventsService.js'; // Placeholder for the service function

/**
 * Handles the request to get webhook events.
 * Extracts webhookId from path parameters and clientUserId from auth context.
 * Calls the service function to fetch events.
 * @param {AuthenticatedRequest} req - The authenticated request object.
 * @param {Response} res - The response object.
 * @param {NextFunction} next - The next middleware function.
 */
export const getWebhookEventsController = async (
    req: Request, // Use standard Request first
    res: Response<ServiceResponse<WebhookEvent[]>>, // Use the specific type here
    next: NextFunction
): Promise<void> => {
    try {
        // Cast to AuthenticatedRequest to access serviceCredentials
        const authReq = req as AuthenticatedRequest;

        // Extract webhookId from path parameters
        const { webhookId } = authReq.params;
        if (!webhookId) {
            const errorResponse: ErrorResponse = {
                success: false,
                error: 'Bad Request',
                details: 'Missing webhookId in path parameters.',
                hint: 'Ensure the webhook ID is included in the URL path: /api/v1/webhooks/{webhookId}/events'
            };
            res.status(400).json(errorResponse);
            return;
        }

        // Extract clientUserId from the authenticated request context
        const clientUserId = authReq.serviceCredentials?.clientUserId;
        if (!clientUserId) {
            console.error('Client User ID not found in serviceCredentials');
            // This should ideally not happen if authMiddleware is working correctly
            const errorResponse: ErrorResponse = {
                success: false,
                error: 'Unauthorized',
                details: 'Authentication context missing required client user ID in serviceCredentials.',
                hint: 'Ensure the request is properly authenticated and includes the required headers.'
            };
            res.status(401).json(errorResponse);
            return;
        }

        // Call the service function to fetch events
        console.log(`Fetching events for webhookId: ${webhookId}, clientUserId: ${clientUserId}`);
        // Pass validated clientUserId (which is guaranteed to be string here)
        const serviceResponse = await getWebhookEventsService(webhookId, clientUserId);

        // Send the response back to the client
        // Handle potential error responses from the service
        if (!serviceResponse.success) {
            console.error('Error fetching webhook events:', serviceResponse.error);
            // Determine appropriate status code based on error type if possible
            const statusCode = (serviceResponse as ErrorResponse).error === 'Not Found' ? 404 : 500;
            res.status(statusCode).json(serviceResponse);
        } else {
            console.log('Successfully fetched webhook events:', serviceResponse.data);
            res.status(200).json(serviceResponse);
        }

    } catch (error) {
        // Pass any unexpected errors to the global error handler
        next(error);
    }
}; 