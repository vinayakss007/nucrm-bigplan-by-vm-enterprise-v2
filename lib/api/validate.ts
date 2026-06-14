import { NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';

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
    ctx: any,
    body: T
  ) => Promise<NextResponse> | NextResponse
) {
  return async (request: Request): Promise<NextResponse> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch (e) {
      console.error('[Validate] Failed to parse request body:', e);
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const result = validateBody(schema, body);
    if (result instanceof NextResponse) return result;

    // Extract auth context from request (set by middleware or requireAuth)
    const ctx = (request as unknown as { ctx: Record<string, unknown> }).ctx;

    return handler(request, ctx, result.data);
  };
}

/**
 * Safe JSON parser with error handling.
 */
export async function safeJson(request: Request): Promise<{ data: any } | NextResponse> {
  try {
    const data = await request.json();
    return { data };
  } catch (e) {
    console.error('[Validate] JSON parse failed:', e);
    return { data: null } as any;
  }
}
