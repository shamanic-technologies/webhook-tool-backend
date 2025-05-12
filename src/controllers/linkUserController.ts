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
  // mapWebhookRecordToWebhook, // This mapping might still be used if Webhook type has complex fields
} from "../services/webhookDefinitionService.js";
import {
  createUserWebhook as createUserWebhookService,
  updateUserWebhookStatus as updateUserWebhookStatusService,
  findUserWebhook as findUserWebhookService,
} from "../services/userWebhookLinkService.js";
import { checkSecretExistsGsm, getSecretGsm } from "../lib/gsm.js";
// import { computeIdentifierHash } from "../lib/crypto.js"; // No longer used
import { WebhookIdParamsSchema } from "../lib/schemas.js";
import { formatValidationError } from "../lib/validationUtils.js";
import { AuthenticatedRequest } from "../middleware/auth.js";
// import { appConfig } from "../index.js"; // appConfig.hmacKey no longer used here
import { constructWebhookTargetUrl } from "../lib/urlUtils.js";

/**
 * Type guard to check if a UtilitySecretType is specifically a UtilityInputSecret.
 * @param secret The secret type to check.
 * @returns True if the secret is a UtilityInputSecret, false otherwise.
 */
function isUtilityInputSecret(
  secret: UtilitySecretType,
): secret is UtilityInputSecret {
  return Object.values(UtilityInputSecret).includes(
    secret as UtilityInputSecret,
  );
}

// --- Helper: Validate Request ---
interface LinkUserValidationResult {
  webhookId: string;
  clientUserId: string;
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

  const clientUserId = (req as AuthenticatedRequest).serviceCredentials?.clientUserId;
  if (!clientUserId) {
    return {
      errorResponse: {
        success: false,
        error: "Unauthorized",
        details: "Client User ID header is required.",
      },
    } as LinkUserValidationResult;
  }
  const platformUserId = (req as AuthenticatedRequest).serviceCredentials?.platformUserId;
  if (!platformUserId) {
    return {
      errorResponse: {
        success: false,
        error: "Unauthorized",
        details: "Platform User ID missing.",
      },
    } as LinkUserValidationResult;
  }
  return { webhookId, clientUserId, platformUserId };
}

// --- Helper: Check Setup Status ---
interface SetupStatusResult {
  isSetupNeeded: boolean;
  setupNeededData?: SetupNeeded;
  // identifierValues is removed as it was tied to clientUserIdentificationMapping
}

/**
 * Checks if further setup is required for the webhook link.
 * This now focuses on general operational secrets (webhook.requiredSecrets) and URL input confirmation.
 * @param webhook The webhook definition.
 * @param clientUserId The client user's ID.
 * @param userWebhookSecret The secret associated with this specific user-webhook link.
 * @returns A promise resolving to an object indicating if setup is needed and relevant data.
 */
async function _checkWebhookSetupStatus(
  webhook: Webhook, // Webhook definition
  clientUserId: string,
): Promise<SetupStatusResult> {
  const missingConfirmations: UtilityActionConfirmation[] = [];

  // Construct the full webhook URL that the user needs to input into the external service
  const webhookUrlToInput = await constructWebhookTargetUrl(
    webhook,
    clientUserId,
  );
  
  const confirmationSecretDbType =
    UtilityActionConfirmation.WEBHOOK_URL_INPUTED;

  // Check if the user has confirmed inputting the webhook URL
  const confirmationCheck = await getSecretGsm(
    UserType.Client,
    clientUserId,
    webhook.webhookProviderId,
    webhook.subscribedEventId,
    confirmationSecretDbType,
  );
  const isUrlInputConfirmed =
    confirmationCheck.success && confirmationCheck.data.value === "true";

  if (!isUrlInputConfirmed) {
    missingConfirmations.push(confirmationSecretDbType);
  }






  if ( missingConfirmations.length > 0) {
    const setupNeededData: SetupNeeded = {
      needsSetup: true,
      utilityProvider: webhook.webhookProviderId,
      utilitySubProvider: webhook.subscribedEventId,
      title: `Webhook Setup Required for ${webhook.name}`,
      message: `Additional setup is needed to activate this webhook`,
      description: `
      1. Provide a clickable link for the user to input into ${webhook.webhookProviderId}.
      2. Provide guidance for the user to enable the event ${webhook.subscribedEventId}
      3. Provide guidance for the user to click on Confirm button once done.
      4. Once done, call again this tool to confirm the status of the webhook link.`,
      webhookUrlToInput: webhookUrlToInput, // Provide the full URL for the user
      ...(missingConfirmations.length > 0 && {
        requiredActionConfirmations: missingConfirmations,
      }),
    };
    return { isSetupNeeded: true, setupNeededData };
  } else {
    return { isSetupNeeded: false }; // No identifierValues needed anymore
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
  console.log(`>>> Entering linkUserController...`);
  try {
    const validation = _validateLinkUserRequest(req);
    if (validation.errorResponse) {
      return res.status(400).json(validation.errorResponse);
    }
    const { webhookId, clientUserId, platformUserId } = validation;

    // 1. Get the generic webhook definition
    const webhook = await getWebhookByIdService(webhookId, clientUserId);
    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        details: "Webhook definition not found.",
      });
    }

    // 2. Find existing UserWebhook link or create a new one
    let userWebhookLink = await findUserWebhookService(
      webhookId,
      clientUserId,
    );
    
    let isNewLink = false; // Keep track for the response status code

    if (!userWebhookLink) {
      isNewLink = true;
      // createUserWebhookService now internally generates and stores the webhook_secret
      userWebhookLink = await createUserWebhookService(
        webhookId,
        clientUserId,
        platformUserId,
        WebhookStatus.PENDING, // New links start as PENDING until setup is confirmed
      );
    }
    
    const currentStatus = userWebhookLink.status;
    const userWebhookSecret = userWebhookLink.webhookSecret; // Crucial for constructing the callback URL

    // 3. Check setup status (confirm URL input, provide operational secrets)
    // We pass webhookDefinition and the specific userWebhookSecret
    const setupStatus = await _checkWebhookSetupStatus(webhook, clientUserId);

    if (setupStatus.isSetupNeeded) {
      // If setup is needed, ensure status is PENDING.
      let finalUserWebhookLink = userWebhookLink; // Use a new var for the result of update
      if (currentStatus === WebhookStatus.ACTIVE) {
        finalUserWebhookLink = await updateUserWebhookStatusService( 
          webhookId,
          clientUserId,
          WebhookStatus.PENDING,
        );
      }
      const response: SuccessResponse<SetupNeeded> = {
        success: true,
        // Use the setupNeededData from setupStatus, which includes the correct webhookUrlToInput
        data: setupStatus.setupNeededData!,
      };
      // Return 200 even if setup is needed, as it's a valid state providing setup instructions.
      return res.status(200).json(response);
    } else {
      // All setup complete, activate the webhook if it's not already active.
      let finalUserWebhook : UserWebhook = userWebhookLink;
      if (currentStatus !== WebhookStatus.ACTIVE) {
        finalUserWebhook = await updateUserWebhookStatusService(
          webhookId,
          clientUserId,
          WebhookStatus.ACTIVE,
        );
      }

      const response: SuccessResponse<UserWebhook> = {
        success: true,
        data: finalUserWebhook, // This now includes the webhookSecret
      };
      return res.status(isNewLink ? 201 : 200).json(response);
    }
  } catch (error) {
    console.error("[Controller Error] Link User:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: "Internal Server Error", details: errorMessage });
  }
};
