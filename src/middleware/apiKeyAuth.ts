// src/middleware/apiKeyAuth.ts

import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to authenticate requests using an API key.
 * Checks for the 'Authorization' header with a Bearer token
 * and validates it against the WEBHOOK_STORE_API_KEY environment variable.
 *
 * @param req - Express request object.
 * @param res - Express response object.
 * @param next - Express next function.
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = process.env.WEBHOOK_STORE_API_KEY;

  // Ensure the API key is configured in the environment
  if (!apiKey) {
    console.error('Error: WEBHOOK_STORE_API_KEY is not set in environment variables.');
    // Throw error in production environments instead of sending 500
    // For simplicity in MVP, we send 500, but ideally should throw.
    res.status(500).json({ message: 'Internal Server Error: API Key not configured.' });
    return;
  }

  const authHeader = req.headers.authorization;

  // Check if Authorization header exists and is in Bearer format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthorized: Missing or invalid Authorization header.' });
    return;
  }

  const providedKey = authHeader.split(' ')[1];

  // Validate the provided API key
  if (providedKey !== apiKey) {
    res.status(401).json({ message: 'Unauthorized: Invalid API Key.' });
    return;
  }

  // If the key is valid, proceed to the next middleware or route handler
  next();
}; 