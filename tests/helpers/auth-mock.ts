/**
 * Authentication Mock Helpers for Tests
 *
 * Provides utilities to mock authenticated requests without a real database.
 * Use these in unit tests to bypass auth middleware.
 */
import { vi } from 'vitest';
import { NextRequest } from 'next/server';

export interface MockAuthContext {
  userId: string;
  tenantId: string;
  email: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  permissions: Record<string, boolean>;
  roleSlug: string;
}

export const DEFAULT_AUTH_CONTEXT: MockAuthContext = {
  userId: 'test-user-001',
  tenantId: 'test-tenant-001',
  email: 'test@nucrm.com',
  isAdmin: true,
  isSuperAdmin: false,
  permissions: { all: true },
  roleSlug: 'admin',
};

/**
 * Create a mock authenticated request with the correct headers/cookies.
 */
export function createAuthenticatedRequest(
  url: string,
  options: RequestInit & { authContext?: Partial<MockAuthContext> } = {}
): NextRequest {
  const { authContext: _authContext, ...reqOptions } = options;

  const headers = new Headers(reqOptions.headers);
  headers.set('cookie', 'nucrm_session=mock-jwt-token');
  headers.set('x-forwarded-for', '127.0.0.1');

  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    ...reqOptions,
    headers,
  });
}

// vi.hoisted ensures this reference exists before vi.mock factory runs
const { mockRequireAuthFn } = vi.hoisted(() => ({
  mockRequireAuthFn: vi.fn(async () => ({
    userId: 'test-user-001',
    tenantId: 'test-tenant-001',
    email: 'test@nucrm.com',
    isAdmin: true,
    isSuperAdmin: false,
    permissions: { all: true },
    roleSlug: 'admin',
  })),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: mockRequireAuthFn,
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn().mockResolvedValue(null),
  can: vi.fn(() => true),
}));

/**
 * Return the current auth context (used in vi.mock factories).
 * Must be called inside the factory, not at module scope.
 */
export function requireAuthContext(): MockAuthContext {
  return { ...DEFAULT_AUTH_CONTEXT };
}

/**
 * Mock the requireAuth middleware to return a specific context.
 * Call this in beforeEach() to bypass real JWT verification.
 */
export function mockRequireAuth(context: Partial<MockAuthContext> = {}) {
  const ctx = { ...DEFAULT_AUTH_CONTEXT, ...context };
  mockRequireAuthFn.mockResolvedValue(ctx);
  return ctx;
}

/**
 * Create a NextRequest for testing API routes.
 */
export function createTestRequest(
  path: string,
  options: {
    method?: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    body?: any;
    searchParams?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const url = new URL(path, 'http://localhost:3000');

  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const headers = new Headers({
    'content-type': 'application/json',
    'cookie': 'nucrm_session=mock-jwt-token',
    'x-forwarded-for': '127.0.0.1',
    ...options.headers,
  });

  const init: RequestInit = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body && options.method !== 'GET') {
    init.body = JSON.stringify(options.body);
  }

  return new NextRequest(url, init);
}
