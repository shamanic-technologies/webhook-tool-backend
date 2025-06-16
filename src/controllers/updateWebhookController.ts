import { Request, Response } from 'express';
import * as webhookDefinitionService from '../services/webhookDefinitionService.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { WebhookData } from '@agent-base/types';

export const updateWebhookController = async (req: Request, res: Response) => {
    const { webhookId } = req.params;
    const updates: Partial<WebhookData> = req.body;
    const { clientUserId, clientOrganizationId } = (req as AuthenticatedRequest).humanInternalCredentials;

    if (!updates || Object.keys(updates).length === 0) {
        console.error('Request body is empty or invalid.');
        return res.status(400).json({ success: false, error: 'Request body is empty or invalid.' });
    }

    try {
        const updatedWebhook = await webhookDefinitionService.updateWebhook(
            webhookId,
            updates,
            clientUserId,
            clientOrganizationId
        );
        return res.status(200).json({ success: true, data: updatedWebhook });
    } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
            return res.status(404).json({ success: false, error: error.message });
        }
        console.error('Error updating webhook:', error);
        return res.status(500).json({ success: false, error: 'Failed to update webhook.' });
    }
}; 