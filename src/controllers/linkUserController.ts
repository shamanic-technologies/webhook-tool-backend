/**
 * Controller: Link User to Webhook
 */
import { Response, NextFunction, Request } from "express";
import {
  Webhook,
  ServiceResponse,
  SuccessResponse,
  ErrorResponse,
  UserType,
  WebhookStatus,
  UtilitySecretType,
  UserWebhook,
  UtilityInputSecret,
  UtilityActionConfirmation,
  SetupNeeded,
} from "@agent-base/types";
import {
  getWebhookById as getWebhookByIdService,
  mapWebhookRecordToWebhook,
} from "../services/webhookDefinitionService.js";
import {
  createUserWebhook as createUserWebhookService,
  updateUserWebhookStatus as updateUserWebhookStatusService,
  findUserWebhook as findUserWebhookService,
  mapUserWebhookRecordToUserWebhook,
} from "../services/userWebhookLinkService.js";
import { checkSecretExistsGsm, getSecretGsm } from "../lib/gsm.js";
import { computeIdentifierHash } from "../lib/crypto.js";
import { WebhookIdParamsSchema } from "../lib/schemas.js";
import { formatValidationError } from "../lib/validationUtils.js";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { appConfig } from "../index.js";
import { constructWebhookTargetUrl } from "../lib/urlUtils.js";

// Type guard to check if a UtilitySecretType is specifically a UtilityInputSecret
function isUtilityInputSecret(
  secret: UtilitySecretType,
): secret is UtilityInputSecret {
  return Object.values(UtilityInputSecret).includes(
    secret as UtilityInputSecret,
  );
}

// --- Helper: Validate Request ---
// (Keep helpers specific to this controller in the same file for now)
interface LinkUserValidationResult {
  webhookId: string;
  clientUserId: string;
  platformUserId: string;
  errorResponse?: ErrorResponse;
}

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
  identifierValues?: Record<string, any>;
}

async function _checkWebhookSetupStatus(
  webhook: Webhook,
  clientUserId: string,
): Promise<SetupStatusResult> {
  const missingInputs: UtilityInputSecret[] = [];
  const missingConfirmations: UtilityActionConfirmation[] = [];
  const identifierValues: Record<string, any> = {};
  const webhookUrlToInput = constructWebhookTargetUrl(clientUserId, webhook.webhookProviderId, webhook.subscribedEventId);
  const confirmationSecretDbType =
    UtilityActionConfirmation.WEBHOOK_URL_INPUTED;

  const confirmationCheck = await getSecretGsm(
    UserType.Client,
    clientUserId,
    webhook.webhookProviderId,
    webhook.subscribedEventId,
    confirmationSecretDbType,
  );
  const isConfirmed =
    confirmationCheck.success && confirmationCheck.data.value === "true";

  if (!isConfirmed) {
    missingConfirmations.push(confirmationSecretDbType);
  }

  // --- Get required secret VALUES from the mapping keys ---
  // Keys are now guaranteed to be enum values like 'api_identifier' by the schema
  const requiredSecretsForIdentificationValues = Object.keys(
    webhook.clientUserIdentificationMapping,
  ) as UtilityInputSecret[];
  console.log(
    "DEBUG: Required Identification Secret Values:",
    requiredSecretsForIdentificationValues,
  );

  // --- Get all required secret VALUES ---
  // webhook.requiredSecrets already contains enum values (UtilitySecretType)
  const allRequiredSecretValues = [
    ...new Set([
      ...webhook.requiredSecrets,
      ...requiredSecretsForIdentificationValues,
    ]),
  ];
  console.log("DEBUG: All Required Secret Values:", allRequiredSecretValues);

  // --- Loop through secret VALUES ---
  for (const secretTypeValue of allRequiredSecretValues) {
    if (secretTypeValue === confirmationSecretDbType) continue;

    // Use the secret VALUE for checks and fetching
    const gsmCheck = await checkSecretExistsGsm(
      UserType.Client,
      clientUserId,
      webhook.webhookProviderId,
      webhook.subscribedEventId,
      secretTypeValue,
    );

    if (!gsmCheck.success || !gsmCheck.data.exists) {
      // Use the VALUE to check if it's an input secret
      // Check if the value is one of the UtilityInputSecret enum values
      if (isUtilityInputSecret(secretTypeValue)) {
        missingInputs.push(secretTypeValue);
      }
      // Check if this secret VALUE is needed for identification
    } else if (
      requiredSecretsForIdentificationValues.includes(
        secretTypeValue as UtilityInputSecret,
      )
    ) {
      console.log(
        `DEBUG: Secret value ${secretTypeValue} exists and is needed for identification. Attempting to get its value...`,
      );
      const secretValueResult = await getSecretGsm(
        UserType.Client,
        clientUserId,
        webhook.webhookProviderId,
        webhook.subscribedEventId,
        secretTypeValue,
      );
      if (secretValueResult.success && secretValueResult.data.value !== null) {
        // Store using the secret VALUE as the key
        identifierValues[secretTypeValue] = secretValueResult.data.value;
      } else {
        console.error(
          `Failed to get value for required secret ${secretTypeValue}, treating as missing.`,
        );
        // Check if value is one of the UtilityInputSecret enum values before pushing
        if (isUtilityInputSecret(secretTypeValue)) {
          missingInputs.push(secretTypeValue);
        }
      }
    }
  }

  // Return results (checking missingInputs/Confirmations)
  if (missingInputs.length > 0 || missingConfirmations.length > 0) {
    const setupNeededData: SetupNeeded = {
      needsSetup: true,
      utilityProvider: webhook.webhookProviderId,
      utilitySubProvider: webhook.subscribedEventId,
      title: `Webhook Setup Required for ${webhook.name}`,
      message: `Additional setup is needed...`,
      description: `Please provide missing secrets/confirm actions. Webhook URL: ${webhookUrlToInput}`,
      webhookUrlToInput: webhookUrlToInput,
      ...(missingInputs.length > 0 && { requiredSecretInputs: missingInputs }),
      ...(missingConfirmations.length > 0 && {
        requiredActionConfirmations: missingConfirmations,
      }),
    };
    return { isSetupNeeded: true, setupNeededData };
  } else {
    // Setup complete, return the identifier values
    // The check for mismatch should happen outside this helper
    return { isSetupNeeded: false, identifierValues };
  }
}

// --- Controller: linkUserController ---
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

    const webhook = await getWebhookByIdService(webhookId);
    if (!webhook) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        details: "Webhook not found.",
      });
    }

    let userWebhookRecord = await findUserWebhookService(
      webhookId,
      clientUserId,
    );
    const isNewLink = !userWebhookRecord;
    if (isNewLink) {
      userWebhookRecord = await createUserWebhookService(
        webhookId,
        clientUserId,
        platformUserId,
        WebhookStatus.PENDING,
        null,
      );
    }
    const currentStatus = userWebhookRecord!.status;

    const setupStatus = await _checkWebhookSetupStatus(webhook, clientUserId);

    if (setupStatus.isSetupNeeded) {
      if (currentStatus === WebhookStatus.ACTIVE) {
        await updateUserWebhookStatusService(
          webhookId,
          clientUserId,
          WebhookStatus.PENDING,
          null,
        );
      }
      const response: SuccessResponse<SetupNeeded> = {
        success: true,
        data: setupStatus.setupNeededData!,
      };
      return res.status(200).json(response);
    } else {
      // Check identifier count (moved logic)
      const requiredSecretsForIdentificationValues = Object.keys(
        webhook.clientUserIdentificationMapping,
      ) as UtilityInputSecret[];
      if (
        Object.keys(setupStatus.identifierValues!).length !==
        requiredSecretsForIdentificationValues.length
      ) {
        console.error(
          "Mismatch count: required identification values vs fetched values.",
        );
        return res.status(500).json({
          success: false,
          error: "Internal Server Error",
          details: "Failed to retrieve all required identification values.",
        });
      }

      if (!appConfig.hmacKey) {
        throw new Error("HMAC key configuration error.");
      }
      const identificationHash = computeIdentifierHash(
        setupStatus.identifierValues!,
        appConfig.hmacKey,
      );
      userWebhookRecord = await updateUserWebhookStatusService(
        webhookId,
        clientUserId,
        WebhookStatus.ACTIVE,
        identificationHash,
      );

      const userWebhook = mapUserWebhookRecordToUserWebhook(userWebhookRecord);
      const response: SuccessResponse<UserWebhook> = {
        success: true,
        data: userWebhook,
      };
      return res.status(isNewLink ? 201 : 200).json(response);
    }
  } catch (error) {
    console.error("[Controller Error] Link User:", error);
    next(error);
  }
};
