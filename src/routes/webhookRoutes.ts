/**
 * Webhook API Routes
 *
 * Defines the Express routes for the webhook store API.
 */
import { Router } from 'express';
// Import controllers from their individual files
import { createWebhookController } from '../controllers/createWebhookController.js';
import { searchWebhooksController } from '../controllers/searchWebhooksController.js';
import { linkUserController } from '../controllers/linkUserController.js';
import { linkAgentController } from '../controllers/linkAgentController.js';
import { incomingWebhookController } from '../controllers/incomingWebhookController.js';
import { getUserCreatedWebhooksController } from '../controllers/getUserCreatedWebhooksController.js';
import { getWebhookEventsController } from '../controllers/getWebhookEventsController.js';
import { getLatestWebhookEventsController } from '../controllers/getLatestWebhookEventsController.js';
import { renameWebhookController } from '../controllers/renameWebhookController.js';
import { deleteWebhookController } from '../controllers/deleteWebhookController.js';
import { updateWebhookController } from '../controllers/updateWebhookController.js';
import { authMiddleware } from '../middleware/auth.js';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';

const router: Router = Router();

// Define public routes FIRST
// Route for internal gateway service to resolve incoming webhooks - NO AUTH
router.post('/incoming/:webhookProviderId/:subscribedEventId/:clientUserId/:clientOrganizationId', incomingWebhookController);

// Routes requiring standard user/service authentication
const authenticatedRouter = Router();
authenticatedRouter.use(apiKeyAuth);
authenticatedRouter.use(authMiddleware);

authenticatedRouter.post('/', createWebhookController);
authenticatedRouter.post('/search', searchWebhooksController);
authenticatedRouter.post('/:webhookId/link-user', linkUserController);
authenticatedRouter.post('/:webhookId/link-agent', linkAgentController);
authenticatedRouter.patch('/:webhookId/rename', renameWebhookController);
authenticatedRouter.delete('/:webhookId', deleteWebhookController);
authenticatedRouter.put('/:webhookId', updateWebhookController);
authenticatedRouter.get('/get-user-created-webhooks', getUserCreatedWebhooksController);
authenticatedRouter.get('/:webhookId/events', getWebhookEventsController);
authenticatedRouter.get('/events/latest', getLatestWebhookEventsController);

router.use('/', authenticatedRouter); // Mount authenticated routes AFTER public routes

export default router; 