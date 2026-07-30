/**
 * Safe JSON Parse with Size Limits
 *
 * Provides a type-safe, size-limited JSON body parser that rejects:
 * - Payloads exceeding a configurable max size (default 1MB)
 * - Malformed JSON with clear error messages
 * - Non-object top-level values (array/null/string not allowed for most APIs)
 *
 * Why:
 * - req.json() in Next.js provides NO size limiting
 * - A malicious client can send a 500MB body and crash the server
 * - JSON.parse errors produce confusing messages for API consumers
 * - Several routes already have ad-hoc size checks — this standardizes them
 *
 * Usage:
 * ```ts
 * import { parseJsonBody } from '@/lib/api/safe-json-parse';
 *
 * export async function POST(req: NextRequest) {
 *   const result = await parseJsonBody(req);
 *   if (result.error) return result.error; // NextResponse with 400/413
 *   const body = result.data; // typed as Record<string, unknown>
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';

export interface ParseOptions {
  /** Maximum body size in bytes (default: 1MB) */
  maxBytes?: number;
  /** Allow arrays as top-level value (default: false) */
  allowArray?: boolean;
  /** Allow null/primitive as top-level value (default: false) */
  allowPrimitive?: boolean;
}

export type ParseSuccess<T = Record<string, unknown>> = {
  data: T;
  error: null;
  rawSize: number;
};

export type ParseFailure = {
  data: null;
  error: NextResponse;
  rawSize: number;
};

export type ParseResult<T = Record<string, unknown>> = ParseSuccess<T> | ParseFailure;

const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MB

/**
 * Parse request body with size and type validation.
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  req: NextRequest,
  options: ParseOptions = {},
): Promise<ParseResult<T>> {
  const { maxBytes = DEFAULT_MAX_BYTES, allowArray = false, allowPrimitive = false } = options;

  // Check Content-Length header first (fast path)
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const declaredSize = parseInt(contentLength, 10);
    if (!isNaN(declaredSize) && declaredSize > maxBytes) {
      return {
        data: null,
        rawSize: declaredSize,
        error: NextResponse.json(
          {
            error: 'Request body too large',
            maxBytes,
            declaredBytes: declaredSize,
            code: 'BODY_TOO_LARGE',
          },
          { status: 413 },
        ),
      };
    }
  }

  // Read the body as text
  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return {
      data: null,
      rawSize: 0,
      error: NextResponse.json(
        { error: 'Failed to read request body', code: 'BODY_READ_ERROR' },
        { status: 400 },
      ),
    };
  }

  const rawSize = Buffer.byteLength(rawText, 'utf-8');

  // Check actual size
  if (rawSize > maxBytes) {
    return {
      data: null,
      rawSize,
      error: NextResponse.json(
        {
          error: 'Request body too large',
          maxBytes,
          actualBytes: rawSize,
          code: 'BODY_TOO_LARGE',
        },
        { status: 413 },
      ),
    };
  }

  // Empty body
  if (!rawText.trim()) {
    return {
      data: null,
      rawSize: 0,
      error: NextResponse.json(
        { error: 'Request body is empty', code: 'BODY_EMPTY' },
        { status: 400 },
      ),
    };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    const message = e instanceof SyntaxError ? e.message : 'Invalid JSON';
    return {
      data: null,
      rawSize,
      error: NextResponse.json(
        { error: `Malformed JSON: ${message}`, code: 'INVALID_JSON' },
        { status: 400 },
      ),
    };
  }

  // Type checks
  if (parsed === null || parsed === undefined) {
    if (!allowPrimitive) {
      return {
        data: null,
        rawSize,
        error: NextResponse.json(
          { error: 'Request body must be a JSON object', code: 'INVALID_TYPE' },
          { status: 400 },
        ),
      };
    }
  } else if (Array.isArray(parsed)) {
    if (!allowArray) {
      return {
        data: null,
        rawSize,
        error: NextResponse.json(
          { error: 'Request body must be a JSON object, not an array', code: 'INVALID_TYPE' },
          { status: 400 },
        ),
      };
    }
  } else if (typeof parsed !== 'object') {
    if (!allowPrimitive) {
      return {
        data: null,
        rawSize,
        error: NextResponse.json(
          { error: 'Request body must be a JSON object', code: 'INVALID_TYPE' },
          { status: 400 },
        ),
      };
    }
  }

  return {
    data: parsed as T,
    error: null,
    rawSize,
  };
}
