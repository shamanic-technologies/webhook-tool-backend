/**
 * Authentication Middleware
 *
 * Extracts ServiceCredentials from request headers and validates them.
 * Attaches credentials to the request object for downstream handlers.
 */
import { Request, Response, NextFunction } from 'express';
import { ServiceCredentials, ErrorResponse } from '@agent-base/types';

// Define a custom request type that includes the credentials
export interface AuthenticatedRequest extends Request {
  serviceCredentials?: ServiceCredentials;
}

// Constants for header names (consider making these configurable)
const HEADER_PLATFORM_API_KEY = 'x-platform-api-key';
const HEADER_PLATFORM_USER_ID = 'x-platform-user-id';
const HEADER_CLIENT_USER_ID = 'x-client-user-id'; // Optional depending on endpoint needs
const HEADER_AGENT_ID = 'x-agent-id'; // Optional depending on endpoint needs

/**
 * Express middleware to extract and validate ServiceCredentials.
 *
 * Expects headers:
 * - `x-platform-api-key`: Required
 * - `x-platform-user-id`: Required
 * - `x-client-user-id`: Optional
 * - `x-agent-id`: Optional
 *
 * If required headers are missing or invalid, sends a 401 Unauthorized response.
 * Otherwise, attaches credentials to `req.serviceCredentials` and calls `next()`.
 */
export const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const platformApiKey = req.headers[HEADER_PLATFORM_API_KEY] as string;
  const platformUserId = req.headers[HEADER_PLATFORM_USER_ID] as string;
  const clientUserId = req.headers[HEADER_CLIENT_USER_ID] as string | undefined;
  const agentId = req.headers[HEADER_AGENT_ID] as string | undefined;

  // Basic validation: Check for required headers
  if (!platformApiKey || !platformUserId) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: 'Unauthorized',
      message: `Missing required headers: ${!platformApiKey ? HEADER_PLATFORM_API_KEY : ''} ${!platformUserId ? HEADER_PLATFORM_USER_ID : ''}`.trim(),
    };
    return res.status(401).json(errorResponse);
  }

  // Attach credentials to the request object
  // Note: Further validation (e.g., checking API key validity against a database)
  // would typically happen here or in a dedicated service.
  req.serviceCredentials = {
    platformApiKey,
    platformUserId,
    clientUserId, // Will be undefined if header not present
    agentId,      // Will be undefined if header not present
  };

  // Proceed to the next middleware or route handler
  next();
}; 