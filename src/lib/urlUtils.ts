/**
 * Utility functions for URL construction.
 */

/**
 * Constructs the target URL for a webhook.
 * This URL is typically used as the endpoint where webhook events are sent.
 *
 * @param clientUserId - The unique identifier of the client user.
 * @param webhookProviderId - The unique identifier of the webhook provider (e.g., "stripe", "github").
 * @param subscribedEventId - The specific event the webhook is subscribed to (e.g., "invoice.payment_succeeded", "push").
 * @returns The fully constructed webhook target URL.
 * @throws Error if the WEBHOOK_URL environment variable is not set.
 */
export function constructWebhookTargetUrl(
  clientUserId: string,
  webhookProviderId: string,
  subscribedEventId: string,
): string {
  const baseWebhookUrl = process.env.WEBHOOK_URL;
  if (!baseWebhookUrl) {
    throw new Error(
      "WEBHOOK_URL environment variable is not set. Cannot construct target URL.",
    );
  }
  return `${baseWebhookUrl}/${webhookProviderId}/${subscribedEventId}/${clientUserId}`;
} 