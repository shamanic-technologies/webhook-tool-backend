import { ZodError } from 'zod';
import { ErrorResponse } from '@agent-base/types';

/**
 * Formats Zod validation errors into a standard ErrorResponse object.
 * @param error The ZodError instance.
 * @returns An ErrorResponse object detailing the validation failures.
 */
export const formatValidationError = (error: ZodError): ErrorResponse => {
    const details = error.errors.map(e => `${e.path.join('.')} - ${e.message}`).join('; ');
    return {
        success: false,
        error: 'Validation Error',
        message: 'Invalid request input.',
        details: details
    };
}; 