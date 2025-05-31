/**
 * Controller: Link User to Webhook
 * This controller handles the process of linking a client user to a specific webhook definition.
 * It manages the creation and activation of user-specific webhook configurations.
 */
import { Response, NextFunction, Request } from "express";
import {
  Webhook, // Represents the webhook definition
  ServiceResponse,
  SuccessResponse,
  ErrorResponse,
  UserType,
  WebhookStatus,
  UtilitySecretType, // General type for secrets
  UserWebhook,      // Represents the user-specific webhook link
  UtilityInputSecret, // Specific type for secrets the user needs to input
  UtilityActionConfirmation, // Specific type for actions the user needs to confirm
  SetupNeeded,      // Object returned if more setup is needed from the user
} from "@agent-base/types";
import {
  getWebhookById as getWebhookByIdService,
} from "../services/webhookDefinitionService.js";
import {
  createUserWebhook as createUserWebhookService,
  updateUserWebhookStatus as updateUserWebhookStatusService,
  findUserWebhook as findUserWebhookService,
} from "../services/userWebhookLinkService.js";
import { gsmClient } from "../index.js"; // Import the initialized GSM client
import { generateSecretManagerId } from "@agent-base/secret-client"; // Standard import path
import { WebhookIdParamsSchema } from "../lib/schemas.js";
import { formatValidationError } from "../lib/validationUtils.js";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { constructWebhookTargetUrl } from "../lib/urlUtils.js";


// --- Helper: Validate Request ---
interface LinkUserValidationResult {
  webhookId: string;
  clientUserId: string;
  clientOrganizationId: string;
  platformUserId: string;
  errorResponse?: ErrorResponse;
}

/**
 * Validates the incoming request for the link user operation.
 * Ensures required parameters (webhookId) and headers (clientUserId, platformUserId) are present.
 * @param req The Express request object.
 * @returns Validation result containing extracted IDs or an errorResponse.
 */
function _validateLinkUserRequest(
  req: Request,
): LinkUserValidationResult {
  const paramsValidation = WebhookIdParamsSchema.safeParse(req.params);
  if (!paramsValidation.success) {
    return {
      errorResponse: formatValidationError(paramsValidation.error),
    } as LinkUserValidationResult;
  }
  const { webhookId } = paramsValidation.data;

  const clientUserId = (req as AuthenticatedRequest).humanInternalCredentials?.clientUserId;
  if (!clientUserId) {
    return {
      errorResponse: {
        success: false,
        error: "Unauthorized",
        details: "Client User ID header is required.",
      },
    } as LinkUserValidationResult;
  }
  const clientOrganizationId = (req as AuthenticatedRequest).humanInternalCredentials?.clientOrganizationId;
  if (!clientOrganizationId) {
    return {
      errorResponse: {
        success: false,
        error: "Unauthorized",
        details: "Client Organization ID header is required.",
      },
    } as LinkUserValidationResult;
  }
  const platformUserId = (req as AuthenticatedRequest).humanInternalCredentials?.platformUserId;
  if (!platformUserId) {
    return {
      errorResponse: {
        success: false,
        error: "Unauthorized",
        details: "Platform User ID missing.",
      },
    } as LinkUserValidationResult;
  }
  return { webhookId, clientUserId, clientOrganizationId, platformUserId };
}

// --- Helper: Check Setup Status ---
interface SetupStatusResult {
  isSetupNeeded: boolean;
  setupNeededData?: SetupNeeded;
}

/**
 * Checks if further setup is required for the webhook link.
 * This now focuses on general operational secrets (webhook.requiredSecrets) and URL input confirmation.
 * @param webhook The webhook definition.
 * @param clientUserId The client user's ID.
 * @returns A promise resolving to an object indicating if setup is needed and relevant data.
 */
async function _checkWebhookSetupStatus(
  webhook: Webhook, // Webhook definition
  clientUserId: string,
  clientOrganizationId: string,
): Promise<SetupStatusResult> {
  const missingConfirmations: UtilityActionConfirmation[] = [];

  const webhookUrlToInput = await constructWebhookTargetUrl(
    webhook,
    clientUserId,
    clientOrganizationId,
  );
  
  // Use the specific enum type for confirmation actions
  const confirmationActionType = UtilityActionConfirmation.WEBHOOK_URL_INPUTED;

  // Check if the user has confirmed inputting the webhook URL
  // The generateSecretManagerId expects a UtilityInputSecret type for secretType.
  // We assume UtilityActionConfirmation.WEBHOOK_URL_INPUTED (a string enum/constant) 
  // is compatible or assignable to UtilityInputSecret.
  const applicationSecretId = generateSecretManagerId(
    UserType.Client,
    clientUserId,
    clientOrganizationId,
    webhook.webhookProviderId,
    confirmationActionType,
    webhook.subscribedEventId, 
  );

  try {
    const secretValue = await gsmClient.getSecret(applicationSecretId);
    const isUrlInputConfirmed = secretValue === "true";

    if (!isUrlInputConfirmed) {
      missingConfirmations.push(confirmationActionType);
    }
  } catch (error: any) {
    console.error(`Error checking secret for URL confirmation (${applicationSecretId}):`, error);
    missingConfirmations.push(confirmationActionType); 
  }

  if (missingConfirmations.length > 0) {
    const setupNeededData: SetupNeeded = {
      needsSetup: true,
      utilityProvider: webhook.webhookProviderId,
      utilitySubProvider: webhook.subscribedEventId,
      title: `Webhook Setup Required for ${webhook.name}`,
      message: `Additional setup is needed to activate this webhook`,
      description: `
      1. Provide a clickable link for the user to input the webhook URL into ${webhook.webhookProviderId}'s dashboard.
      2. Provide guidance for the user to enable the event ${webhook.subscribedEventId}
      3. Provide guidance for the user to click on "Confirm" button within the current chat interface once done.
      4. Once clicked, ask the user to notify you.
      5. Once notified, call again this tool to confirm the status of the webhook link.`,
      webhookUrlToInput: webhookUrlToInput, 
      ...(missingConfirmations.length > 0 && {
        requiredActionConfirmations: missingConfirmations,
      }),
    };
    return { isSetupNeeded: true, setupNeededData };
  } else {
    return { isSetupNeeded: false };
  }
}

// --- Controller: linkUserController ---
/**
 * Handles the request to link a user to a webhook.
 * - Fetches or creates a UserWebhook record (which includes the unique webhookSecret).
 * - Checks if any setup (like confirming URL input or providing operational secrets) is needed.
 * - Activates the UserWebhook if setup is complete.
 */
export const linkUserController = async (
  req: Request,
  res: Response<ServiceResponse<UserWebhook | SetupNeeded>>,
  next: NextFunction,
) => {
  try {
    const validation = _validateLinkUserRequest(req);
    if (validation.errorResponse) {
      return res.status(400).json(validation.errorResponse);
    }
    const { webhookId, clientUserId, clientOrganizationId, platformUserId } = validation;

    const webhook = await getWebhookByIdService(webhookId);
    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        details: "Webhook definition not found.",
      });
    }

    let userWebhookLink = await findUserWebhookService(
      webhookId,
      clientUserId,
      clientOrganizationId,
    );
    
    let isNewLink = false;

    if (!userWebhookLink) {
      isNewLink = true;
      userWebhookLink = await createUserWebhookService(
        webhookId,
        clientUserId,
        clientOrganizationId,
        platformUserId,
        WebhookStatus.UNSET, 
      );
    }
    
    const currentStatus = userWebhookLink.status;

    const setupStatus = await _checkWebhookSetupStatus(webhook, clientUserId, clientOrganizationId);

    if (setupStatus.isSetupNeeded) {
      let finalUserWebhookLink = userWebhookLink;
      if (currentStatus === WebhookStatus.ACTIVE) {
        finalUserWebhookLink = await updateUserWebhookStatusService( 
          webhookId,
          clientUserId,
          clientOrganizationId,
          WebhookStatus.UNSET,
        );
      }
      const response: SuccessResponse<SetupNeeded> = {
        success: true,
        data: setupStatus.setupNeededData!,
        hint: "Once confirmation from the user that the setup is complete, call again this tool to activate the webhook user link"
      };
      return res.status(200).json(response);
    } else {
      let finalUserWebhook : UserWebhook = userWebhookLink;
      if (currentStatus !== WebhookStatus.ACTIVE) {
        finalUserWebhook = await updateUserWebhookStatusService(
          webhookId,
          clientUserId,
          clientOrganizationId,
          WebhookStatus.ACTIVE,
        );
      }

      const response: SuccessResponse<UserWebhook> = {
        success: true,
        data: finalUserWebhook,
        hint: "Now you can link this webhook to an agent (take yourself by default) by calling the webhook link agent tool",
      };
      return res.status(isNewLink ? 201 : 200).json(response);
    }
  } catch (error: any) { // Explicitly type error
    console.error("[Controller Error] Link User:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: "Internal Server Error", details: errorMessage });
  }
};
