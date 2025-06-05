/**
 * Controller for retrieving the N latest webhook events for a specific client user and organization.
 */
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { ServiceResponse, ErrorResponse, WebhookEvent } from '@agent-base/types';
import { getLatestWebhookEventsForUserOrgService } from '../services/getWebhookEventsService.js';

const DEFAULT_EVENT_LIMIT = 10;
const MAX_EVENT_LIMIT = 100;

/**
 * Handles the request to get the N latest webhook events.
 * Extracts clientUserId and clientOrganizationId from auth context.
 * Extracts 'limit' from query parameters.
 * Calls the service function to fetch events.
 * @param {Request} req - The request object (will be cast to AuthenticatedRequest).
 * @param {Response} res - The response object.
 * @param {NextFunction} next - The next middleware function.
 */
export const getLatestWebhookEventsController = async (
    req: Request,
    res: Response<ServiceResponse<WebhookEvent[]>>,
    next: NextFunction
): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;

        const clientUserId = authReq.humanInternalCredentials?.clientUserId;
        const clientOrganizationId = authReq.humanInternalCredentials?.clientOrganizationId;

        if (!clientUserId) {
            const errorResponse: ErrorResponse = {
                success: false,
                error: 'Unauthorized',
                details: 'Authentication context missing required client user ID.',
                hint: 'Ensure you are properly authenticated. Contact support if this persists.'
            };
            res.status(401).json(errorResponse);
            return;
        }

        if (!clientOrganizationId) {
            const errorResponse: ErrorResponse = {
                success: false,
                error: 'Unauthorized',
                details: 'Authentication context missing required client organization ID.',
                hint: 'Ensure you are properly authenticated. Contact support if this persists.'
            };
            res.status(401).json(errorResponse);
            return;
        }

        let limit = DEFAULT_EVENT_LIMIT;
        if (req.query.limit) {
            const parsedLimit = parseInt(req.query.limit as string, 10);
            if (isNaN(parsedLimit) || parsedLimit <= 0) {
                const errorResponse: ErrorResponse = {
                    success: false,
                    error: 'Bad Request',
                    details: "Invalid 'limit' query parameter. Must be a positive integer.",
                    hint: `Provide a positive integer for 'limit', e.g., ?limit=5. Max is ${MAX_EVENT_LIMIT}.`
                };
                res.status(400).json(errorResponse);
                return;
            }
            limit = Math.min(parsedLimit, MAX_EVENT_LIMIT);
        }

        console.log(`[Controller] Fetching latest ${limit} events for clientUserId: ${clientUserId}, clientOrganizationId: ${clientOrganizationId}`);
        const serviceResponse = await getLatestWebhookEventsForUserOrgService(clientUserId, clientOrganizationId, limit);

        if (!serviceResponse.success) {
            console.error('[Controller] Error fetching latest webhook events:', serviceResponse.error, serviceResponse.details);
            let statusCode = 500;
            if ((serviceResponse as ErrorResponse).error === 'Bad Request') statusCode = 400;
            if ((serviceResponse as ErrorResponse).error === 'Unauthorized') statusCode = 401;
            if ((serviceResponse as ErrorResponse).error === 'Data Integrity Error') statusCode = 500;
            
            res.status(statusCode).json(serviceResponse);
        } else {
            console.log('[Controller] Successfully fetched latest webhook events:', serviceResponse.data?.length);
            res.status(200).json(serviceResponse);
        }

    } catch (error) {
        console.error('[Controller] Unexpected error in getLatestWebhookEventsController:', error);
        next(error);
    }
}; 