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
import { resolveWebhookController } from '../controllers/resolveWebhookController.js';
import { getUserCreatedWebhooksController } from '../controllers/getUserCreatedWebhooksController.js';
import { authMiddleware } from '../middleware/auth.js';

const router: Router = Router();

// Define public routes FIRST
// Route for internal gateway service to resolve incoming webhooks - NO AUTH
router.post('/resolve', resolveWebhookController);

// Routes requiring standard user/service authentication
const authenticatedRouter = Router();
authenticatedRouter.use(authMiddleware);

authenticatedRouter.post('/', createWebhookController);
authenticatedRouter.post('/search', searchWebhooksController);
authenticatedRouter.post('/:webhookId/link-user', linkUserController);
authenticatedRouter.post('/:webhookId/link-agent', linkAgentController);
authenticatedRouter.get('/get-user-created-webhooks', getUserCreatedWebhooksController);

router.use('/', authenticatedRouter); // Mount authenticated routes AFTER public routes

// Route for internal gateway service to resolve incoming webhooks
// router.post('/resolve', resolveWebhookController); // REMOVE from here

export default router; 