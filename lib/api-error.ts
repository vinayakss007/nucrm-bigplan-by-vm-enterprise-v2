import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export function apiError(err: unknown, message = 'Internal server error', status = 500) {
  const isDev = process.env.NODE_ENV === 'development';
  console.error(`[API Error ${status}]`, err instanceof Error ? err.message : err);

  if (status >= 500) {
    Sentry.captureException(err);
  } else {
    Sentry.addBreadcrumb({ category: 'api', message, level: 'warning' });
  }

  return NextResponse.json(
    { error: isDev && err instanceof Error ? err.message : message },
    { status }
  );
}

export function notFound(entity = 'Resource') {
  return NextResponse.json({ error: `${entity} not found` }, { status: 404 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function unauthorized(message = 'Authentication required') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'Access denied') {
  return NextResponse.json({ error: message }, { status: 403 });
}
