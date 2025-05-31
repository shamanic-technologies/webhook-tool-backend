/**
 * Controller: Create Webhook Definition
 */
import { Response, NextFunction, Request } from "express";
import {
  Webhook,
  ServiceResponse,
  SuccessResponse,
  UtilityProvider,
  ErrorResponse,
  WebhookData,
} from "@agent-base/types";
import {
  createWebhook,
} from "../services/webhookDefinitionService.js";
import { generateEmbedding } from "../lib/embeddingUtils.js";
import { CreateWebhookSchema } from "../lib/schemas.js";
import { formatValidationError } from "../lib/validationUtils.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

/**
 * Controller for POST / - Create a new webhook definition.
 */
export const createWebhookController = async (
  req: Request,
  res: Response<ServiceResponse<Webhook>>,
  next: NextFunction,
) => {
  console.log(">>> Entering createWebhookController");
  try {
    // clientUserId is guaranteed to be a string by authMiddleware.
    const clientUserId = (req as AuthenticatedRequest).humanInternalCredentials!.clientUserId!;
    const clientOrganizationId = (req as AuthenticatedRequest).humanInternalCredentials!.clientOrganizationId!;
    const validationResult = CreateWebhookSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res
        .status(400)
        .json(formatValidationError(validationResult.error));
    }

    const webhookData : WebhookData = {
      ...validationResult.data,
      webhookProviderId: validationResult.data
        .webhookProviderId as UtilityProvider,
      conversationIdIdentificationMapping:
        validationResult.data.conversationIdIdentificationMapping,
      creatorClientUserId: clientUserId,
      creatorClientOrganizationId: clientOrganizationId,
    };


    const embedding = await generateEmbedding(
      `${webhookData.name} ${webhookData.description}`,
    );
    const newWebhook = await createWebhook(
      webhookData,
      embedding,
      clientUserId,
      clientOrganizationId,
    );
    const response: SuccessResponse<Webhook> = {
      success: true,
      data: newWebhook,
      hint: "Now you can link this webhook to the user by calling the webhook link user tool",
    };
    console.log("DEBUG: Create Webhook Response:", JSON.stringify(response));
    res.status(201).json(response);
  } catch (error) {
    console.error("[Controller Error] Create Webhook:", error);
    next(error);
  }
};
