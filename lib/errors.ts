import 'server-only';
import { NextResponse } from 'next/server';
import { ErrorCode, type ApiError } from '@/lib/errors-shared';

export { ErrorCode, type ApiError } from '@/lib/errors-shared';
export type { ErrorLevel } from '@/lib/errors-shared';

export class AppError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public statusCode: number = 500,
    public details?: string,
    public field?: string
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON(): ApiError {
    return {
      error: this.message,
      code: this.code,
      details: this.details,
      field: this.field,
    };
  }

  toResponse(): NextResponse<ApiError> {
    return NextResponse.json(this.toJSON(), { status: this.statusCode });
  }
}

export class AuthError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.AUTH_UNAUTHORIZED,
    details?: string
  ) {
    super(message, code, 401, details);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied', details?: string) {
    super(message, ErrorCode.AUTH_FORBIDDEN, 403, details);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource', details?: string) {
    super(`${resource} not found`, ErrorCode.RESOURCE_NOT_FOUND, 404, details);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', field?: string, details?: string) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, details, field);
    this.name = 'ValidationError';
  }

  static requiredField(fieldName: string): ValidationError {
    return new ValidationError(`${fieldName} is required`, fieldName, ErrorCode.VALIDATION_REQUIRED_FIELD);
  }

  static invalidFormat(fieldName: string, expected: string): ValidationError {
    return new ValidationError(
      `${fieldName} has invalid format. Expected: ${expected}`,
      fieldName,
      ErrorCode.VALIDATION_INVALID_FORMAT
    );
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: string) {
    super(message, ErrorCode.USER_ALREADY_EXISTS, 409, details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super(
      'Rate limit exceeded. Please try again later.',
      ErrorCode.RATE_LIMIT_EXCEEDED,
      429,
      retryAfter ? `Retry after ${retryAfter} seconds` : undefined
    );
    this.name = 'RateLimitError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: string) {
    super(message, ErrorCode.DB_QUERY_FAILED, 500, details);
    this.name = 'DatabaseError';
  }
}

export class EmailError extends AppError {
  constructor(message: string, details?: string) {
    super(message, ErrorCode.EMAIL_SEND_FAILED, 500, details);
    this.name = 'EmailError';
  }
}

export async function logError(opts: { error: unknown; context?: string; [key: string]: unknown }): Promise<void> {
  console.error(`[logError] ${opts.context ?? ''}`, opts.error);
}

export async function withErrorLogging<T>(fn: () => Promise<T>, context: string, metadata?: Record<string, unknown>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    logError({ error: err, context, ...metadata });
    return null;
  }
}

export function handleError(error: unknown): NextResponse<ApiError> {
  logError({ error, context: 'handleError' });

  if (error instanceof AppError) {
    return error.toResponse();
  }

  if (error instanceof Error) {
    if (error.name === 'DatabaseError' || error.message.includes('database')) {
      return new DatabaseError('Database operation failed').toResponse();
    }

    if (error.message.includes('validation')) {
      return new ValidationError(error.message).toResponse();
    }
  }

  return new AppError(
    'An unexpected error occurred',
    ErrorCode.INTERNAL_ERROR,
    500
  ).toResponse();
}

export function createErrorResponse(
  code: ErrorCode,
  message: string,
  statusCode: number,
  details?: string,
  field?: string
): NextResponse<ApiError> {
  return NextResponse.json(
    {
      error: message,
      code,
      details,
      field,
    },
    { status: statusCode }
  );
}
