import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/v2
 * Versioned API entry point - returns API info and available resources.
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    version: 'v2',
    status: 'stable',
    resources: [
      'contacts',
      'deals',
      'companies',
      'tasks',
      'activities',
      'pipelines',
      'forms',
      'tickets',
      'invoices',
      'webhooks',
      'api-keys',
      'branding',
    ],
    documentation: 'https://docs.nucrm.io/api/v2',
    authentication: {
      methods: ['api_key', 'jwt'],
      api_key_prefix: 'ak_',
      header: 'Authorization: Bearer ak_...',
    },
    rate_limits: {
      default: '1000 requests/minute',
      burst: '50 requests/second',
    },
  });
}
