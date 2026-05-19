import { db } from '@/drizzle/db';
import { errorLogs } from '@/drizzle/schema/support';
import { NextResponse } from 'next/server';

export type ErrorLevel = 'warning' | 'error' | 'fatal';

/**
 * Error codes for standardized API error responses
 */
export enum ErrorCode {
  // Authentication & Authorization
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',
  AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED',
  AUTH_PASSWORD_WEAK = 'AUTH_PASSWORD_WEAK',
  AUTH_EMAIL_NOT_VERIFIED = 'AUTH_EMAIL_NOT_VERIFIED',
  AUTH_ACCOUNT_LOCKED = 'AUTH_ACCOUNT_LOCKED',

  // User errors
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS',
  USER_EMAIL_TAKEN = 'USER_EMAIL_TAKEN',
  USER_CREATE_FAILED = 'USER_CREATE_FAILED',
  USER_UPDATE_FAILED = 'USER_UPDATE_FAILED',
  USER_DELETE_FAILED = 'USER_DELETE_FAILED',

  // Tenant errors
  TENANT_NOT_FOUND = 'TENANT_NOT_FOUND',
  TENANT_ALREADY_EXISTS = 'TENANT_ALREADY_EXISTS',
  TENANT_CREATE_FAILED = 'TENANT_CREATE_FAILED',
  TENANT_UPDATE_FAILED = 'TENANT_UPDATE_FAILED',
  TENANT_DELETE_FAILED = 'TENANT_DELETE_FAILED',
  TENANT_SUBSCRIPTION_EXPIRED = 'TENANT_SUBSCRIPTION_EXPIRED',

  // Contact errors
  CONTACT_NOT_FOUND = 'CONTACT_NOT_FOUND',
  CONTACT_ALREADY_EXISTS = 'CONTACT_ALREADY_EXISTS',
  CONTACT_CREATE_FAILED = 'CONTACT_CREATE_FAILED',
  CONTACT_UPDATE_FAILED = 'CONTACT_UPDATE_FAILED',
  CONTACT_DELETE_FAILED = 'CONTACT_DELETE_FAILED',
  CONTACT_EMAIL_TAKEN = 'CONTACT_EMAIL_TAKEN',

  // Company errors
  COMPANY_NOT_FOUND = 'COMPANY_NOT_FOUND',
  COMPANY_CREATE_FAILED = 'COMPANY_CREATE_FAILED',
  COMPANY_UPDATE_FAILED = 'COMPANY_UPDATE_FAILED',
  COMPANY_DELETE_FAILED = 'COMPANY_DELETE_FAILED',

  // Deal errors
  DEAL_NOT_FOUND = 'DEAL_NOT_FOUND',
  DEAL_CREATE_FAILED = 'DEAL_CREATE_FAILED',
  DEAL_UPDATE_FAILED = 'DEAL_UPDATE_FAILED',
  DEAL_DELETE_FAILED = 'DEAL_DELETE_FAILED',

  // Task errors
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_CREATE_FAILED = 'TASK_CREATE_FAILED',
  TASK_UPDATE_FAILED = 'TASK_UPDATE_FAILED',
  TASK_DELETE_FAILED = 'TASK_DELETE_FAILED',

  // Email errors
  EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED',
  EMAIL_TEMPLATE_NOT_FOUND = 'EMAIL_TEMPLATE_NOT_FOUND',
  EMAIL_INVALID_RECIPIENT = 'EMAIL_INVALID_RECIPIENT',
  EMAIL_QUOTA_EXCEEDED = 'EMAIL_QUOTA_EXCEEDED',

  // Database errors
  DB_CONNECTION_FAILED = 'DB_CONNECTION_FAILED',
  DB_QUERY_FAILED = 'DB_QUERY_FAILED',
  DB_CONSTRAINT_VIOLATION = 'DB_CONSTRAINT_VIOLATION',
  DB_DUPLICATE_KEY = 'DB_DUPLICATE_KEY',
  DB_TRANSACTION_FAILED = 'DB_TRANSACTION_FAILED',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  VALIDATION_REQUIRED_FIELD = 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_INVALID_FORMAT = 'VALIDATION_INVALID_FORMAT',
  VALIDATION_INVALID_LENGTH = 'VALIDATION_INVALID_LENGTH',
  VALIDATION_INVALID_RANGE = 'VALIDATION_INVALID_RANGE',

  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // File errors
  FILE_UPLOAD_FAILED = 'FILE_UPLOAD_FAILED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_INVALID_TYPE = 'FILE_INVALID_TYPE',

  // Webhook errors
  WEBHOOK_DELIVERY_FAILED = 'WEBHOOK_DELIVERY_FAILED',
  WEBHOOK_INVALID_SIGNATURE = 'WEBHOOK_INVALID_SIGNATURE',

  // General errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  OPERATION_FAILED = 'OPERATION_FAILED',
}

/**
 * Standardized API error response
 */
export interface ApiError {
  error: string;
  code: ErrorCode;
  details?: string;
  field?: string;
  requestId?: string;
}

/**
 * Custom error class with error codes
 */
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

/**
 * Authentication error
 */
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

/**
 * Authorization error
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied', details?: string) {
    super(message, ErrorCode.AUTH_FORBIDDEN, 403, details);
    this.name = 'ForbiddenError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource', details?: string) {
    super(`${resource} not found`, ErrorCode.RESOURCE_NOT_FOUND, 404, details);
    this.name = 'NotFoundError';
  }
}

/**
 * Validation error
 */
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

/**
 * Conflict error (duplicate, already exists)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: string) {
    super(message, ErrorCode.USER_ALREADY_EXISTS, 409, details);
    this.name = 'ConflictError';
  }
}

/**
 * Rate limit error
 */
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

/**
 * Database error
 */
export class DatabaseError extends AppError {
  constructor(message: string, details?: string) {
    super(message, ErrorCode.DB_QUERY_FAILED, 500, details);
    this.name = 'DatabaseError';
  }
}

/**
 * Email error
 */
export class EmailError extends AppError {
  constructor(message: string, details?: string) {
    super(message, ErrorCode.EMAIL_SEND_FAILED, 500, details);
    this.name = 'EmailError';
  }
}

export async function logError(opts: {
  error: any;
  context?: string;
  tenantId?: string;
  userId?: string;
  level?: ErrorLevel;
  metadata?: Record<string, any>;
}): Promise<void> {
  const msg = opts.error instanceof Error ? opts.error.message : String(opts.error ?? 'Unknown error');
  const stack = opts.error instanceof Error ? opts.error.stack?.slice(0, 2000) : undefined;
  try {
    await db.insert(errorLogs).values({
      tenantId: opts.tenantId ?? null,
      userId: opts.userId ?? null,
      level: opts.level ?? 'error',
      message: msg.slice(0, 1000),
      stack: stack ?? null,
      context: { context: opts.context, ...opts.metadata },
    });
  } catch (err: any) {
    // Never throw from error logging — log to console as fallback
    console.error('[logError] DB write failed:', msg, '|', err.message);
  }
}

/** Wrap a function and log any errors it throws */
export async function withErrorLogging<T>(
  fn: () => Promise<T>,
  context: string,
  meta?: { tenantId?: string; userId?: string }
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    await logError({ error: err, context, ...meta });
    return null;
  }
}

/**
 * Error handler for API routes
 */
export function handleError(error: unknown): NextResponse<ApiError> {
  console.error('[API Error]', error);

  if (error instanceof AppError) {
    return error.toResponse();
  }

  if (error instanceof Error) {
    // Handle specific error types
    if (error.name === 'DatabaseError' || error.message.includes('database')) {
      return new DatabaseError('Database operation failed').toResponse();
    }

    if (error.message.includes('validation')) {
      return new ValidationError(error.message).toResponse();
    }
  }

  // Default to internal server error
  return new AppError(
    'An unexpected error occurred',
    ErrorCode.INTERNAL_ERROR,
    500
  ).toResponse();
}

/**
 * Create error response helper
 */
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
