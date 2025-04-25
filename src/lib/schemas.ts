/**
 * Zod Schemas for API Request Validation
 *
 * Defines schemas used to validate incoming request bodies, parameters,
 * and potentially query strings for the webhook store API.
 */
import { z } from 'zod';
import { UtilityInputSecret } from '@agent-base/types'; // Import the enum
// We assume UtilityProvider and UtilitySecretType are string enums or types
// Using z.string() for broader compatibility, add specific z.enum if runtime enums are guaranteed
// import { UtilityProvider, UtilitySecretType } from '@agent-base/types'; // Keep import for reference

// Helper for UUID validation
const uuidSchema = z.string().uuid({ message: "Invalid UUID format" });

// Schema for the body of the POST / (create webhook) endpoint
// Corresponds to WebhookData from @agent-base/types
export const CreateWebhookSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().min(1, { message: "Description is required" }),
  // Use z.string() - refine with z.enum if UtilityProvider enum object is available at runtime
  webhookProviderId: z.string().min(1, { message: 'Invalid webhookProviderId' }),
  subscribedEventId: z.string().min(1, { message: "Subscribed event ID is required" }),
  // Use z.string() - refine with z.enum if UtilitySecretType enum object is available at runtime
  requiredSecrets: z.array(z.string()).min(0), // Can be empty array
  // Renamed from userIdentificationMapping
  clientUserIdentificationMapping: z.record(z.string(), z.string(), {
    invalid_type_error: "clientUserIdentificationMapping must be an object mapping secret type string to string"
  })
  // Add refinement to check keys against UtilityInputSecret enum values
  .refine(mapping => {
      const allowedKeys = Object.values(UtilityInputSecret);
      return Object.keys(mapping).every(key => allowedKeys.includes(key as UtilityInputSecret));
    }, {
      message: `Keys in clientUserIdentificationMapping must be valid UtilityInputSecret values (e.g., ${Object.values(UtilityInputSecret).join(', ')})`,
      path: ['clientUserIdentificationMapping'] // Specify the path of the error
  }),
  // Added conversationIdIdentificationMapping
  conversationIdIdentificationMapping: z.string().min(1, { message: "conversationIdIdentificationMapping is required" }),
  eventPayloadSchema: z.record(z.string(), z.unknown(), {
    invalid_type_error: "eventPayloadSchema must be an object"
  }),
  // Add embedding if it needs to be provided during creation
  // embedding: z.array(z.number()).optional(),
});

// Schema for the body of the POST /search endpoint
export const SearchWebhookSchema = z.object({
  query: z.string().min(1, { message: "Search query is required" }),
  // You might add embedding here if the client provides it, or generate it server-side
  // embedding: z.array(z.number()).optional(), 
  limit: z.number().int().positive().optional().default(10),
});

// Schema for the path parameters of /:webhookId/...
export const WebhookIdParamsSchema = z.object({
  webhookId: uuidSchema,
});

// Schema for the body of the POST /:webhookId/link-agent endpoint
export const LinkAgentSchema = z.object({
  agentId: z.string().min(1, { message: "Agent ID is required" }),
});

// Schema for the body of the POST /:webhookId/link-user endpoint (no body needed)
// We will primarily use WebhookIdParamsSchema and credentials from middleware

// Type helper for validated request body
export type ValidatedRequestBody<T extends z.ZodTypeAny> = z.infer<T>; 