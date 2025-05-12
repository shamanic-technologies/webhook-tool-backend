/**
 * Utility functions for URL construction.
 */
import { Webhook } from "@agent-base/types";
import { getUserWebhookByWebhookIdAndClientUserId } from "../services/userWebhookLinkService.js";
import { WebhookRecord } from "../types/db.js";
/**
 * Constructs the target URL for a webhook.
 * This URL is typically used as the endpoint where webhook events are sent.
 *
 * @param clientUserId - The unique identifier of the client user.
 * @param webhookProviderId - The unique identifier of the webhook provider (e.g., "stripe", "github").
 * @param subscribedEventId - The specific event the webhook is subscribed to (e.g., "invoice.payment_succeeded", "push").
 * @param webhookSecret - The secret associated with the webhook.
 * @returns The fully constructed webhook target URL.
 * @throws Error if the WEBHOOK_URL environment variable is not set.
 */
export async function constructWebhookTargetUrl(
  webhook: Webhook,
  clientUserId: string
): Promise<string> {
  const baseWebhookUrl = process.env.WEBHOOK_URL;
  if (!baseWebhookUrl) {
    throw new Error(
      "WEBHOOK_URL environment variable is not set. Cannot construct target URL.",
    );
  }
  const userWebhook = await getUserWebhookByWebhookIdAndClientUserId(webhook.id, clientUserId);
  return `${baseWebhookUrl}/${webhook.webhookProviderId}/${webhook.subscribedEventId}/${clientUserId}?secret=${userWebhook.webhookSecret}`;
} 