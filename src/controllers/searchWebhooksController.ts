/**
 * Controller: Search Webhooks
 */
import { Response, NextFunction, Request } from 'express';
import { 
    Webhook, 
    ServiceResponse, 
    SuccessResponse 
} from '@agent-base/types';
import { 
    searchWebhooks as searchWebhooksService 
} from '../services/webhookDefinitionService.js';
import { generateEmbedding } from '../lib/embeddingUtils.js';
import { SearchWebhookSchema } from '../lib/schemas.js';
import { formatValidationError } from '../lib/validationUtils.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

/**
 * Controller for POST /search - Search for webhooks.
 */
export const searchWebhooksController = async (req: Request, res: Response<ServiceResponse<Webhook[]>>, next: NextFunction) => {
    console.log('>>> Entering searchWebhooksController');
    try {
        // clientUserId is guaranteed to be a string by authMiddleware after its checks.
        const clientUserId = (req as AuthenticatedRequest).serviceCredentials!.clientUserId!;

        const validationResult = SearchWebhookSchema.safeParse(req.body);
        if (!validationResult.success) {
            return res.status(400).json(formatValidationError(validationResult.error));
        }
        const { query: searchQuery, limit } = validationResult.data;

        let queryVector: number[] | null = null;
        if (searchQuery && searchQuery.trim() !== '') {
            queryVector = await generateEmbedding(searchQuery);
        } 
        // If searchQuery is empty or only whitespace, queryVector remains null

        // searchWebhooksService will need to handle a null queryVector
        const webhooksApp = await searchWebhooksService(clientUserId, queryVector, limit);
        const response: SuccessResponse<Webhook[]> = { success: true, data: webhooksApp };
        console.log('DEBUG: Search Webhook Response:', JSON.stringify(response));
        res.status(200).json(response);

    } catch (error) {
        console.error('[Controller Error] Search Webhooks:', error);
        next(error);
    }
}; 