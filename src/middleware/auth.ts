/**
 * Authentication Middleware
 *
 * Extracts ServiceCredentials from request headers and validates them.
 * Attaches credentials to the request object for downstream handlers.
 */
import { Request, Response, NextFunction } from 'express';
import { ErrorResponse, HumanInternalCredentials } from '@agent-base/types';

// Define a custom request type that includes the credentials
export interface AuthenticatedRequest extends Request {
  humanInternalCredentials: HumanInternalCredentials;
}

// Constants for header names (consider making these configurable)
const HEADER_PLATFORM_API_KEY = 'x-platform-api-key';
const HEADER_PLATFORM_USER_ID = 'x-platform-user-id';
const HEADER_CLIENT_USER_ID = 'x-client-user-id'; // Now required
const HEADER_CLIENT_ORGANIZATION_ID = 'x-client-organization-id'; // Now required
const HEADER_AGENT_ID = 'x-agent-id'; // Optional depending on endpoint needs

/**
 * Express middleware to extract and validate ServiceCredentials.
 *
 * Expects headers:
 * - `x-platform-api-key`: Required
 * - `x-platform-user-id`: Required
 * - `x-client-user-id`: Required
 * - `x-client-organization-id`: Required
 * - `x-agent-id`: Optional
 *
 * If required headers are missing or invalid, sends a 401 Unauthorized response.
 * Otherwise, attaches credentials to `req.serviceCredentials` and calls `next()`.
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const platformApiKey = req.headers[HEADER_PLATFORM_API_KEY] as string;
  const platformUserId = req.headers[HEADER_PLATFORM_USER_ID] as string;
  const clientUserId = req.headers[HEADER_CLIENT_USER_ID] as string;
  const clientOrganizationId = req.headers[HEADER_CLIENT_ORGANIZATION_ID] as string;
  const agentId = req.headers[HEADER_AGENT_ID] as string | undefined;

  // Basic validation: Check for required headers
  if (!platformApiKey || !platformUserId || !clientUserId) {
    let missingHeaders = [];
    if (!platformApiKey) missingHeaders.push(HEADER_PLATFORM_API_KEY);
    if (!platformUserId) missingHeaders.push(HEADER_PLATFORM_USER_ID);
    if (!clientUserId) missingHeaders.push(HEADER_CLIENT_USER_ID);

    const errorResponse: ErrorResponse = {
      success: false,
      error: 'Unauthorized',
      details: `Missing required headers: ${missingHeaders.join(', ')}`,
    };
    return res.status(401).json(errorResponse);
  }

  // Attach credentials to the request object
  // Note: Further validation (e.g., checking API key validity against a database)
  // would typically happen here or in a dedicated service.
  (req as AuthenticatedRequest).humanInternalCredentials = {
    platformApiKey,
    platformUserId,
    clientUserId, // Now guaranteed to be present
    clientOrganizationId, // Now guaranteed to be present
    agentId,      // Will be undefined if header not present
  };

  // Proceed to the next middleware or route handler
  next();
}; 