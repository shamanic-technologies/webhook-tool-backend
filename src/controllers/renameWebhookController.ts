import { Request, Response } from 'express';
import * as webhookDefinitionService from '../services/webhookDefinitionService.js';
import { AuthenticatedRequest } from '../middleware/auth.js'; // Assuming this interface provides the credentials

export const renameWebhookController = async (req: Request, res: Response) => {
    const { webhookId } = req.params;
    const { name } = req.body;
    const { clientUserId, clientOrganizationId } = (req as AuthenticatedRequest).humanInternalCredentials;

    if (!name) {
        console.error('New name is required.');
        return res.status(400).json({ success: false, error: 'New name is required.' });
    }

    try {
        const updatedWebhook = await webhookDefinitionService.renameWebhook(
            webhookId,
            name,
            clientUserId,
            clientOrganizationId
        );
        return res.status(200).json({ success: true, data: updatedWebhook });
    } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
            return res.status(404).json({ success: false, error: error.message });
        }
        console.error('Error renaming webhook:', error);
        return res.status(500).json({ success: false, error: 'Failed to rename webhook.' });
    }
}; 