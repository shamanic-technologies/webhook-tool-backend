/**
 * Webhook API Routes
 *
 * Defines the Express routes for the webhook store API.
 */
import { Router } from 'express';
import {
    createWebhookController,
    searchWebhooksController,
    linkUserController,
    linkAgentController,
} from '../controllers/webhookController.js';
import { authMiddleware } from '../middleware/auth.js';

const router: Router = Router();

// Apply auth middleware to all webhook routes
router.use(authMiddleware);

/**
 * @route   POST /api/v1/webhooks
 * @desc    Create a new webhook definition
 * @access  Authenticated
 */
router.post('/', createWebhookController);

/**
 * @route   POST /api/v1/webhooks/search
 * @desc    Search for webhooks using vector similarity
 * @access  Authenticated
 */
router.post('/search', searchWebhooksController);

/**
 * @route   POST /api/v1/webhooks/:webhookId/link-user
 * @desc    Link a webhook to the authenticated client user, checks/requests setup
 * @access  Authenticated (requires x-client-user-id header)
 */
router.post('/:webhookId/link-user', linkUserController);

/**
 * @route   POST /api/v1/webhooks/:webhookId/link-agent
 * @desc    Link an active user-webhook connection to an agent
 * @access  Authenticated (requires x-client-user-id header)
 */
router.post('/:webhookId/link-agent', linkAgentController);

export default router; 