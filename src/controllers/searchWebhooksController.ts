/**
 * Controller: Search Webhooks
 */
import { Response, NextFunction } from 'express';
import { 
    Webhook, 
    ServiceResponse, 
    SuccessResponse 
} from '@agent-base/types';
import { 
    searchWebhooks as searchWebhooksService, 
    mapWebhookRecordToWebhook 
} from '../services/webhookDefinitionService.js';
import { generateEmbedding } from '../lib/embeddingUtils.js';
import { SearchWebhookSchema } from '../lib/schemas.js';
import { formatValidationError } from '../lib/validationUtils.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

/**
 * Controller for POST /search - Search for webhooks.
 */
export const searchWebhooksController = async (req: AuthenticatedRequest, res: Response<ServiceResponse<Webhook[]>>, next: NextFunction) => {
    console.log('>>> Entering searchWebhooksController');
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
        console.log('DEBUG: Search Webhook Response:', JSON.stringify(response));
        res.status(200).json(response);

    } catch (error) {
        console.error('[Controller Error] Search Webhooks:', error);
        next(error);
    }
}; 