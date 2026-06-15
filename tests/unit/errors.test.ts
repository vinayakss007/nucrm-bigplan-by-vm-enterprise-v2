import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('errors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ErrorCode enum', () => {
    it('has auth error codes', async () => {
      const { ErrorCode } = await import('@/lib/errors');
      expect(ErrorCode.AUTH_INVALID_CREDENTIALS).toBe('AUTH_INVALID_CREDENTIALS');
      expect(ErrorCode.AUTH_TOKEN_EXPIRED).toBe('AUTH_TOKEN_EXPIRED');
      expect(ErrorCode.AUTH_TOKEN_INVALID).toBe('AUTH_TOKEN_INVALID');
      expect(ErrorCode.AUTH_UNAUTHORIZED).toBe('AUTH_UNAUTHORIZED');
      expect(ErrorCode.AUTH_FORBIDDEN).toBe('AUTH_FORBIDDEN');
      expect(ErrorCode.AUTH_SESSION_EXPIRED).toBe('AUTH_SESSION_EXPIRED');
      expect(ErrorCode.AUTH_PASSWORD_WEAK).toBe('AUTH_PASSWORD_WEAK');
      expect(ErrorCode.AUTH_EMAIL_NOT_VERIFIED).toBe('AUTH_EMAIL_NOT_VERIFIED');
      expect(ErrorCode.AUTH_ACCOUNT_LOCKED).toBe('AUTH_ACCOUNT_LOCKED');
    });

    it('has user error codes', async () => {
      const { ErrorCode } = await import('@/lib/errors');
      expect(ErrorCode.USER_NOT_FOUND).toBe('USER_NOT_FOUND');
      expect(ErrorCode.USER_ALREADY_EXISTS).toBe('USER_ALREADY_EXISTS');
      expect(ErrorCode.USER_EMAIL_TAKEN).toBe('USER_EMAIL_TAKEN');
      expect(ErrorCode.USER_CREATE_FAILED).toBe('USER_CREATE_FAILED');
      expect(ErrorCode.USER_UPDATE_FAILED).toBe('USER_UPDATE_FAILED');
      expect(ErrorCode.USER_DELETE_FAILED).toBe('USER_DELETE_FAILED');
    });

    it('has general error codes', async () => {
      const { ErrorCode } = await import('@/lib/errors');
      expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
      expect(ErrorCode.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
      expect(ErrorCode.NOT_IMPLEMENTED).toBe('NOT_IMPLEMENTED');
      expect(ErrorCode.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
      expect(ErrorCode.OPERATION_FAILED).toBe('OPERATION_FAILED');
    });

    it('has rate limit error code', async () => {
      const { ErrorCode } = await import('@/lib/errors');
      expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('AppError', () => {
    it('creates app error with defaults', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Something went wrong', ErrorCode.INTERNAL_ERROR);

      expect(error.message).toBe('Something went wrong');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('AppError');
      expect(error.details).toBeUndefined();
      expect(error.field).toBeUndefined();
    });

    it('creates app error with custom status, details, and field', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Bad request', ErrorCode.VALIDATION_ERROR, 400, 'detail info', 'email');

      expect(error.statusCode).toBe(400);
      expect(error.details).toBe('detail info');
      expect(error.field).toBe('email');
    });

    it('toJSON returns structured error object', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Test', ErrorCode.INTERNAL_ERROR, 500, 'details', 'field');

      const json = error.toJSON();
      expect(json.error).toBe('Test');
      expect(json.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(json.details).toBe('details');
      expect(json.field).toBe('field');
    });

    it('toJSON omits undefined details and field', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Test', ErrorCode.INTERNAL_ERROR);

      const json = error.toJSON();
      expect(json.error).toBe('Test');
      expect(json.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(json.details).toBeUndefined();
      expect(json.field).toBeUndefined();
    });

    it('toResponse returns NextResponse', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Test', ErrorCode.INTERNAL_ERROR, 500);

      const response = error.toResponse();
      expect(response).toBeDefined();
      expect(response.status).toBe(500);
    });
  });

  describe('AuthError', () => {
    it('creates auth error with 401', async () => {
      const { AuthError, ErrorCode } = await import('@/lib/errors');
      const error = new AuthError('Invalid credentials');

      expect(error.statusCode).toBe(401);
      expect(error.code).toBe(ErrorCode.AUTH_UNAUTHORIZED);
      expect(error.name).toBe('AuthError');
    });

    it('creates with custom code', async () => {
      const { AuthError, ErrorCode } = await import('@/lib/errors');
      const error = new AuthError('Token expired', ErrorCode.AUTH_TOKEN_EXPIRED);

      expect(error.code).toBe(ErrorCode.AUTH_TOKEN_EXPIRED);
    });

    it('creates with details', async () => {
      const { AuthError } = await import('@/lib/errors');
      const error = new AuthError('Blocked', undefined, 'Account locked for 24h');

      expect(error.details).toBe('Account locked for 24h');
    });
  });

  describe('ForbiddenError', () => {
    it('creates forbidden error with 403', async () => {
      const { ForbiddenError, ErrorCode } = await import('@/lib/errors');
      const error = new ForbiddenError();

      expect(error.statusCode).toBe(403);
      expect(error.code).toBe(ErrorCode.AUTH_FORBIDDEN);
      expect(error.name).toBe('ForbiddenError');
    });

    it('creates with custom message', async () => {
      const { ForbiddenError } = await import('@/lib/errors');
      const error = new ForbiddenError('Custom message');

      expect(error.message).toBe('Custom message');
    });

    it('uses default message when not provided', async () => {
      const { ForbiddenError } = await import('@/lib/errors');
      const error = new ForbiddenError();

      expect(error.message).toBe('Access denied');
    });
  });

  describe('NotFoundError', () => {
    it('creates not found error with 404', async () => {
      const { NotFoundError, ErrorCode } = await import('@/lib/errors');
      const error = new NotFoundError('User');

      expect(error.statusCode).toBe(404);
      expect(error.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
      expect(error.message).toBe('User not found');
    });

    it('uses default resource name when omitted', async () => {
      const { NotFoundError } = await import('@/lib/errors');
      const error = new NotFoundError();

      expect(error.message).toBe('Resource not found');
    });

    it('accepts optional details', async () => {
      const { NotFoundError } = await import('@/lib/errors');
      const error = new NotFoundError('Order', 'Order ID: 12345');

      expect(error.message).toBe('Order not found');
      expect(error.details).toBe('Order ID: 12345');
    });
  });

  describe('ValidationError', () => {
    it('creates validation error with 400', async () => {
      const { ValidationError, ErrorCode } = await import('@/lib/errors');
      const error = new ValidationError('Invalid input');

      expect(error.statusCode).toBe(400);
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('creates with field and details', async () => {
      const { ValidationError, ErrorCode: _ErrorCode } = await import('@/lib/errors');
      const error = new ValidationError('Invalid email', 'email', 'Must be valid format');

      expect(error.field).toBe('email');
      expect(error.details).toBe('Must be valid format');
    });

    it('uses default message when omitted', async () => {
      const { ValidationError } = await import('@/lib/errors');
      const error = new ValidationError();

      expect(error.message).toBe('Validation failed');
    });

    it('requiredField factory creates error with correct message', async () => {
      const { ValidationError, ErrorCode } = await import('@/lib/errors');
      const error = ValidationError.requiredField('email');

      expect(error.message).toBe('email is required');
      expect(error.field).toBe('email');
      expect(error.details).toBe(ErrorCode.VALIDATION_REQUIRED_FIELD);
      expect(error.name).toBe('ValidationError');
    });

    it('invalidFormat factory creates error with expected format message', async () => {
      const { ValidationError } = await import('@/lib/errors');
      const error = ValidationError.invalidFormat('date', 'YYYY-MM-DD');

      expect(error.message).toContain('invalid format');
      expect(error.message).toContain('YYYY-MM-DD');
      expect(error.field).toBe('date');
      expect(error.name).toBe('ValidationError');
    });
  });

  describe('ConflictError', () => {
    it('creates conflict error with 409', async () => {
      const { ConflictError, ErrorCode } = await import('@/lib/errors');
      const error = new ConflictError('Already exists');

      expect(error.statusCode).toBe(409);
      expect(error.code).toBe(ErrorCode.USER_ALREADY_EXISTS);
      expect(error.name).toBe('ConflictError');
    });

    it('accepts optional details', async () => {
      const { ConflictError } = await import('@/lib/errors');
      const error = new ConflictError('Duplicate', 'User with email already exists');

      expect(error.details).toBe('User with email already exists');
    });
  });

  describe('RateLimitError', () => {
    it('creates rate limit error with 429', async () => {
      const { RateLimitError, ErrorCode } = await import('@/lib/errors');
      const error = new RateLimitError(60);

      expect(error.statusCode).toBe(429);
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.name).toBe('RateLimitError');
    });

    it('includes retry after in details', async () => {
      const { RateLimitError } = await import('@/lib/errors');
      const error = new RateLimitError(30);

      expect(error.details).toBe('Retry after 30 seconds');
    });

    it('omits details when retryAfter not provided', async () => {
      const { RateLimitError } = await import('@/lib/errors');
      const error = new RateLimitError();

      expect(error.details).toBeUndefined();
    });

    it('has default rate limit message', async () => {
      const { RateLimitError } = await import('@/lib/errors');
      const error = new RateLimitError();

      expect(error.message).toBe('Rate limit exceeded. Please try again later.');
    });
  });

  describe('DatabaseError', () => {
    it('creates database error with 500', async () => {
      const { DatabaseError, ErrorCode } = await import('@/lib/errors');
      const error = new DatabaseError('Query failed', 'timeout');

      expect(error.statusCode).toBe(500);
      expect(error.code).toBe(ErrorCode.DB_QUERY_FAILED);
      expect(error.details).toBe('timeout');
      expect(error.name).toBe('DatabaseError');
    });
  });

  describe('EmailError', () => {
    it('creates email error with 500', async () => {
      const { EmailError, ErrorCode } = await import('@/lib/errors');
      const error = new EmailError('Failed to send');

      expect(error.statusCode).toBe(500);
      expect(error.code).toBe(ErrorCode.EMAIL_SEND_FAILED);
      expect(error.name).toBe('EmailError');
    });
  });

  describe('logError', () => {
    it('logs error with context', async () => {
      const { logError } = await import('@/lib/errors');
      logError({ error: new Error('test error'), context: 'test-context' });

      expect(console.error).toHaveBeenCalledWith(
        '[logError] test-context',
        expect.any(Error)
      );
    });

    it('logs error without context', async () => {
      const { logError } = await import('@/lib/errors');
      logError({ error: 'string error' });

      expect(console.error).toHaveBeenCalledWith(
        '[logError] ',
        'string error'
      );
    });

    it('includes extra metadata fields', async () => {
      const { logError } = await import('@/lib/errors');
      logError({ error: new Error('err'), context: 'ctx', userId: 'u1', requestId: 'r1' });

      expect(console.error).toHaveBeenCalledWith(
        '[logError] ctx',
        expect.any(Error)
      );
    });
  });

  describe('withErrorLogging', () => {
    it('returns result when fn succeeds', async () => {
      const { withErrorLogging } = await import('@/lib/errors');
      const result = await withErrorLogging(async () => 'success', 'test');

      expect(result).toBe('success');
    });

    it('returns null and logs when fn throws', async () => {
      const { withErrorLogging } = await import('@/lib/errors');
      const result = await withErrorLogging(async () => {
        throw new Error('fail');
      }, 'test-context');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalled();
    });

    it('passes metadata to logError on failure', async () => {
      const { withErrorLogging } = await import('@/lib/errors');
      const err = new Error('fail');
      const result = await withErrorLogging(async () => { throw err; }, 'ctx', { userId: 'u1' });

      expect(result).toBeNull();
    });
  });

  describe('handleError', () => {
    it('returns AppError response for AppError instances', async () => {
      const { handleError, AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Test', ErrorCode.INTERNAL_ERROR, 500);

      const response = handleError(error);
      expect(response).toBeDefined();
      expect(response.status).toBe(500);
    });

    it('returns DatabaseError for database-related errors', async () => {
      const { handleError, ErrorCode: _ErrorCode } = await import('@/lib/errors');

      const error = new Error('database connection failed');
      const response = handleError(error);
      expect(response).toBeDefined();
      expect(response.status).toBe(500);
    });

    it('returns ValidationError for validation-related errors', async () => {
      const { handleError, ErrorCode: _ErrorCode } = await import('@/lib/errors');

      const error = new Error('validation error in input');
      const response = handleError(error);
      expect(response).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('returns generic 500 for unknown errors', async () => {
      const { handleError, ErrorCode: _ErrorCode } = await import('@/lib/errors');

      const response = handleError(null);
      expect(response).toBeDefined();
      expect(response.status).toBe(500);
    });

    it('returns generic 500 for non-Error unknown types', async () => {
      const { handleError } = await import('@/lib/errors');

      const response = handleError('string error');
      expect(response).toBeDefined();
      expect(response.status).toBe(500);
    });

    it('handles DatabaseError name pattern matching', async () => {
      const { handleError, DatabaseError } = await import('@/lib/errors');

      const dbErr = new DatabaseError('DB connectivity issue');
      const response = handleError(dbErr);
      expect(response).toBeDefined();
      expect(response.status).toBe(500);
    });
  });

  describe('createErrorResponse', () => {
    it('creates a JSON error response with given params', async () => {
      const { createErrorResponse, ErrorCode } = await import('@/lib/errors');

      const response = createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        'Error occurred',
        500,
        'detail',
        'field'
      );

      expect(response).toBeDefined();
      expect(response.status).toBe(500);
    });

    it('creates response without optional details', async () => {
      const { createErrorResponse, ErrorCode } = await import('@/lib/errors');

      const response = createErrorResponse(ErrorCode.NOT_FOUND, 'Not found', 404);
      expect(response.status).toBe(404);
    });
  });
});
