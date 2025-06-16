import { Request, Response } from 'express';
import * as webhookDefinitionService from '../services/webhookDefinitionService.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export const deleteWebhookController = async (req: Request, res: Response) => {
    const { webhookId } = req.params;
    const { clientUserId, clientOrganizationId } = (req as AuthenticatedRequest).humanInternalCredentials;

    try {
        await webhookDefinitionService.deleteWebhook(webhookId, clientUserId, clientOrganizationId);
        return res.status(204).send();
    } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
            return res.status(404).json({ success: false, error: error.message });
        }
        console.error('Error deleting webhook:', error);
        return res.status(500).json({ success: false, error: 'Failed to delete webhook.' });
    }
}; 