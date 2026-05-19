import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('errors', () => {
  describe('AppError', () => {
    it('creates app error with defaults', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Something went wrong', ErrorCode.INTERNAL_ERROR);
      
      expect(error.message).toBe('Something went wrong');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('AppError');
    });

    it('creates app error with custom status', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Bad request', ErrorCode.VALIDATION_ERROR, 400);
      
      expect(error.statusCode).toBe(400);
    });

    it('toJSON returns error object', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Test', ErrorCode.INTERNAL_ERROR, 500, 'details', 'field');
      
      const json = error.toJSON();
      expect(json.error).toBe('Test');
      expect(json.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(json.details).toBe('details');
      expect(json.field).toBe('field');
    });

    it('toResponse returns NextResponse', async () => {
      const { AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Test', ErrorCode.INTERNAL_ERROR, 500);
      
      const response = error.toResponse();
      expect(response).toBeDefined();
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
  });

  describe('NotFoundError', () => {
    it('creates not found error with 404', async () => {
      const { NotFoundError, ErrorCode } = await import('@/lib/errors');
      const error = new NotFoundError('User');
      
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
      expect(error.message).toBe('User not found');
    });

    it('uses default resource name', async () => {
      const { NotFoundError } = await import('@/lib/errors');
      const error = new NotFoundError();
      
      expect(error.message).toBe('Resource not found');
    });
  });

  describe('ValidationError', () => {
    it('creates validation error with 400', async () => {
      const { ValidationError, ErrorCode } = await import('@/lib/errors');
      const error = new ValidationError('Invalid input');
      
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('creates required field error', async () => {
      const { ValidationError } = await import('@/lib/errors');
      const error = ValidationError.requiredField('email');
      
      expect(error).toBeDefined();
      expect(error.name).toBe('ValidationError');
    });

    it('creates invalid format error', async () => {
      const { ValidationError } = await import('@/lib/errors');
      const error = ValidationError.invalidFormat('date', 'YYYY-MM-DD');
      
      expect(error).toBeDefined();
      expect(error.message).toContain('invalid format');
    });
  });

  describe('ConflictError', () => {
    it('creates conflict error with 409', async () => {
      const { ConflictError, ErrorCode } = await import('@/lib/errors');
      const error = new ConflictError('Already exists');
      
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe(ErrorCode.USER_ALREADY_EXISTS);
    });
  });

  describe('RateLimitError', () => {
    it('creates rate limit error with 429', async () => {
      const { RateLimitError, ErrorCode } = await import('@/lib/errors');
      const error = new RateLimitError(60);
      
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
    });

    it('creates without retryAfter', async () => {
      const { RateLimitError } = await import('@/lib/errors');
      const error = new RateLimitError();
      
      expect(error.details).toBeUndefined();
    });
  });

  describe('DatabaseError', () => {
    it('creates database error', async () => {
      const { DatabaseError, ErrorCode } = await import('@/lib/errors');
      const error = new DatabaseError('Query failed', 'timeout');
      
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe(ErrorCode.DB_QUERY_FAILED);
      expect(error.details).toBe('timeout');
    });
  });

  describe('EmailError', () => {
    it('creates email error', async () => {
      const { EmailError, ErrorCode } = await import('@/lib/errors');
      const error = new EmailError('Failed to send');
      
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe(ErrorCode.EMAIL_SEND_FAILED);
    });
  });

  describe('handleError', () => {
    it('handles AppError', async () => {
      const { handleError, AppError, ErrorCode } = await import('@/lib/errors');
      const error = new AppError('Test', ErrorCode.INTERNAL_ERROR, 500);
      
      const response = handleError(error);
      expect(response).toBeDefined();
    });

    it('handles generic errors', async () => {
      const { handleError } = await import('@/lib/errors');
      const error = new Error('Generic error');
      
      const response = handleError(error);
      expect(response).toBeDefined();
    });

    it('handles unknown errors', async () => {
      const { handleError } = await import('@/lib/errors');
      
      const response = handleError(null);
      expect(response).toBeDefined();
    });
  });

  describe('createErrorResponse', () => {
    it('creates error response', async () => {
      const { createErrorResponse, ErrorCode } = await import('@/lib/errors');
      
      const response = createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        'Error occurred',
        500
      );
      
      expect(response).toBeDefined();
    });
  });
});
