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
} from "@agent-base/types";
import {
  createWebhook,
  mapWebhookRecordToWebhook,
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
    const clientUserId = (req as AuthenticatedRequest).serviceCredentials!.clientUserId!;

    const validationResult = CreateWebhookSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res
        .status(400)
        .json(formatValidationError(validationResult.error));
    }

    const webhookData = {
      ...validationResult.data,
      webhookProviderId: validationResult.data
        .webhookProviderId as UtilityProvider,
      requiredSecrets: validationResult.data.requiredSecrets,
      clientUserIdentificationMapping:
        validationResult.data.clientUserIdentificationMapping,
      conversationIdIdentificationMapping:
        validationResult.data.conversationIdIdentificationMapping,
      creatorClientUserId: clientUserId,
    };

    // Validate input consistency: Ensure all keys in clientUserIdentificationMapping
    // are also present in requiredSecrets.
    for (const secretTypeNeededForMapping in webhookData.clientUserIdentificationMapping) {
      if (!webhookData.requiredSecrets.includes(secretTypeNeededForMapping)) {
        return res.status(400).json({
          success: false,
          error: "Validation Error",
          details: `Secret '${secretTypeNeededForMapping}' is used in clientUserIdentificationMapping but not listed in requiredSecrets.`,
        } as ErrorResponse);
      }
    }

    const embedding = await generateEmbedding(
      `${webhookData.name} ${webhookData.description}`,
    );
    const newWebhook = await createWebhook(
      webhookData,
      embedding,
      clientUserId,
    );
    const response: SuccessResponse<Webhook> = {
      success: true,
      data: newWebhook,
    };
    console.log("DEBUG: Create Webhook Response:", JSON.stringify(response));
    res.status(201).json(response);
  } catch (error) {
    console.error("[Controller Error] Create Webhook:", error);
    next(error);
  }
};
