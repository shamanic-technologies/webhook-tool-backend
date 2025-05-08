/**
 * Controller: Create Webhook Definition
 */
import { Response, NextFunction } from "express";
import {
  Webhook,
  ServiceResponse,
  SuccessResponse,
  UtilityProvider,
  UtilitySecretType,
} from "@agent-base/types";
import {
  createWebhookService,
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
  req: AuthenticatedRequest,
  res: Response<ServiceResponse<Webhook>>,
  next: NextFunction,
) => {
  console.log(">>> Entering createWebhookController");
  try {
    // --- Get clientUserId from authenticated credentials ---
    const clientUserId = req.serviceCredentials?.clientUserId;
    if (!clientUserId) {
      // This should not happen if authMiddleware requires it implicitly for this route
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Client User ID missing from authentication credentials.",
      });
    }
    // --- End Get clientUserId ---

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
    };

    // Validate input consistency: Ensure all keys in clientUserIdentificationMapping
    // are also present in requiredSecrets.
    for (const secretTypeNeededForMapping in webhookData.clientUserIdentificationMapping) {
      if (!webhookData.requiredSecrets.includes(secretTypeNeededForMapping)) {
        return res.status(400).json({
          success: false,
          error: "Validation Error",
          message: `Secret '${secretTypeNeededForMapping}' is used in clientUserIdentificationMapping but not listed in requiredSecrets.`,
        });
      }
    }

    const embedding = await generateEmbedding(
      `${webhookData.name} ${webhookData.description}`,
    );
    const newWebhookRecord = await createWebhookService(
      webhookData,
      embedding,
      clientUserId,
    );
    const webhookApp = mapWebhookRecordToWebhook(newWebhookRecord);
    const response: SuccessResponse<Webhook> = {
      success: true,
      data: webhookApp,
    };
    console.log("DEBUG: Create Webhook Response:", JSON.stringify(response));
    res.status(201).json(response);
  } catch (error) {
    console.error("[Controller Error] Create Webhook:", error);
    next(error);
  }
};
