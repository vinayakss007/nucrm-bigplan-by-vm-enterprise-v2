import { NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';
import { logger } from '@/lib/logger';

/**
 * Validate request body against a Zod schema.
 * Returns parsed data or a 400 response with field-level errors.
 */
export function validateBody<T>(schema: ZodSchema<T>, body: unknown): { data: T } | NextResponse {
  try {
    const data = schema.parse(body);
    return { data };
  } catch (err) {
    if (err instanceof ZodError) {
      const errors = err.issues.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return NextResponse.json(
        { error: 'Validation failed', details: errors },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

/**
 * Validate query parameters against a Zod schema.
 * Returns parsed data or a 400 response with field-level errors.
 */
export function validateQuery<T>(schema: ZodSchema<T>, params: Record<string, string | undefined>): { data: T } | NextResponse {
  try {
    const data = schema.parse(params);
    return { data };
  } catch (err) {
    if (err instanceof ZodError) {
      const errors = err.issues.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return NextResponse.json(
        { error: 'Invalid query parameters', details: errors },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  }
}

/**
 * Validate a single value against a Zod schema.
 * Returns parsed value or throws ValidationError.
 */
export function validateField<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value);
}

/**
 * Higher-order wrapper for POST/PUT route handlers with automatic body validation.
 *
 * Usage:
 * export const POST = withValidation(createContactSchema, async (req, ctx, body) => {
 *   // body is fully typed and validated
 * });
 */
export function withValidation<T>(
  schema: ZodSchema<T>,
  handler: (
    request: Request,
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: any,
    body: T
  ) => Promise<NextResponse> | NextResponse
) {
  return async (request: Request): Promise<NextResponse> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch (e) {
      console.error('[Validate] Invalid JSON body', e);
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const result = validateBody(schema, body);
    if (result instanceof NextResponse) return result;

    // Extract auth context from request (set by middleware or requireAuth)
    const ctx = (request as unknown as { ctx: Record<string, unknown> }).ctx;

    return handler(request, ctx, result.data);
  };
}

/**
 * Thrown when the request body is not parseable JSON.
 *
 * This exists as a distinct type so `apiError()` can answer 400 instead of 500
 * without having to guess. A bare `SyntaxError` is not a safe signal: a
 * server-side `JSON.parse` of corrupt stored data throws exactly the same
 * messages, and reporting that as a client error would hide real corruption.
 */
export class InvalidJsonBodyError extends Error {
  constructor(cause?: unknown) {
    super('Invalid JSON body', { cause });
    this.name = 'InvalidJsonBodyError';
  }
}

/**
 * Read and parse a JSON request body.
 *
 * Drop-in replacement for `await request.json()`. The only difference is the
 * failure mode: a malformed body raises {@link InvalidJsonBodyError}, which
 * `apiError()` renders as a 400. Calling `request.json()` directly produced an
 * untagged `SyntaxError`, which every route's catch block turned into a 500 —
 * telling the caller the server broke when in fact their request was malformed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch (e) {
    throw new InvalidJsonBodyError(e);
  }
}

/**
 * Safe JSON parser that returns a 400 response instead of throwing.
 *
 * Prefer {@link readJsonBody} in routes that already have a try/catch ending in
 * `apiError()` — it keeps the happy path free of response plumbing. This variant
 * suits routes that want to branch on the failure inline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safeJson(request: Request): Promise<{ data: any } | NextResponse> {
  try {
    return { data: await readJsonBody(request) };
  } catch (e) {
    logger.warn('[validate] Rejected malformed JSON body', {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
