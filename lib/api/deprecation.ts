/**
 * API v1 Deprecation Middleware
 * 
 * Adds deprecation headers and logs usage of deprecated v1 endpoints.
 * All v1 routes should include this middleware to warn consumers
 * and track migration progress.
 */

import { logger } from '@/lib/logger';

const DEPRECATION_DATE = '2026-09-01';
const SUNSET_DATE = '2026-12-01';
const MIGRATION_GUIDE_URL = '/api-docs#migration-v1-to-v2';

const v1ToV2Mapping: Record<string, string> = {
  '/api/v1/contacts': '/api/tenant/contacts',
  '/api/v1/deals': '/api/tenant/deals',
  '/api/v1/leads': '/api/tenant/contacts',
  '/api/v1/tasks': '/api/tenant/tasks',
  '/api/v1/auth': '/api/auth',
};

export function withDeprecationHeaders(handler: (...args: unknown[]) => Promise<unknown>) {
  return async function deprecatedHandler(request: Request, context: any) {
    const response = await handler(request, context);

    const url = new URL(request.url);
    const v2Path = v1ToV2Mapping[url.pathname] || '/api/tenant';

    response.headers.set('Deprecation', 'true');
    response.headers.set('Sunset', SUNSET_DATE);
    response.headers.set('Link', `<${MIGRATION_GUIDE_URL}>; rel="deprecation"; title="Migration Guide"`);
    response.headers.set('X-API-Version', 'v1-deprecated');
    response.headers.set('X-API-V2-Path', v2Path);

    logger.warn('[api-deprecation] v1 endpoint accessed', {
      path: url.pathname,
      method: request.method,
      v2Alternative: v2Path,
      userAgent: request.headers.get('user-agent'),
    });

    return response;
  };
}

export { DEPRECATION_DATE, SUNSET_DATE, MIGRATION_GUIDE_URL, v1ToV2Mapping };
