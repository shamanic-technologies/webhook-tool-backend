import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { ServiceResponse, ErrorResponse } from '@agent-base/types';
// Import routers
import webhookRoutes from './routes/webhookRoutes.js'; // Import the router and add .js
import { authMiddleware } from './middleware/auth.js'; // Keep if needed globally, remove if only on webhookRoutes

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3001;

// --- Middleware ---

// Enable JSON body parsing
app.use(express.json());

// Placeholder for authentication middleware (to extract ServiceCredentials)
// app.use(authMiddleware); 

// --- Routes ---

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', provider: 'webhook-store' });
});

// Mount webhook routes under /api/v1
app.use('/api/v1/webhooks', webhookRoutes);

// --- Error Handling ---

// Catch-all for unhandled routes (after defined routes)
app.use((req: Request, res: Response, next: NextFunction) => {
  const errorResponse: ErrorResponse = {
    success: false,
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} not found.`,
  };
  res.status(404).json(errorResponse);
});

// Global error handler
app.use((err: Error, req: Request, res: Response<ServiceResponse<never>>, next: NextFunction) => {
  console.error('Unhandled Error:', err.stack || err);

  // Avoid sending detailed errors in production
  const message = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message;
  const details = process.env.NODE_ENV === 'production' ? undefined : err.stack;

  const errorResponse: ErrorResponse = {
    success: false,
    error: err.name === 'ZodError' ? 'Validation Error' : 'Internal Server Error',
    message: message,
    details: details,
  };
  
  // Use appropriate status code (e.g., 400 for validation errors)
  const statusCode = err.name === 'ZodError' ? 400 : 500;
  res.status(statusCode).json(errorResponse);
});

// --- Server Start ---

app.listen(port, () => {
  console.log(`[server]: Webhook Store server is running at http://localhost:${port}`);
});

export default app; // Export for potential testing 