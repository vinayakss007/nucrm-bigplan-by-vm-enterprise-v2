/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveGatewayTenant, validateCORS } from '@/lib/api/gateway';

/**
 * Catch-all handler for /api/v2/*
 * Resolves tenant via gateway and proxies to /api/tenant/* routes.
 */

function setCORSHeaders(response: NextResponse, origin: string | null): NextResponse {
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID, X-Requested-With');
  response.headers.set('Vary', 'Origin');
  return response;
}

async function handleRequest(request: NextRequest, params: { path: string[] }): Promise<NextResponse> {
  const origin = request.headers.get('origin');

  // Resolve tenant from gateway
  const resolution = await resolveGatewayTenant(request);
  if (!resolution) {
    const errorResponse = NextResponse.json(
      { error: 'Unable to resolve tenant. Provide API key, X-Tenant-ID header, or use a custom domain.' },
      { status: 401 }
    );
    return setCORSHeaders(errorResponse, origin);
  }

  // Validate CORS for the resolved tenant
  const corsValid = await validateCORS(origin, resolution.tenantId);
  if (!corsValid) {
    const errorResponse = NextResponse.json(
      { error: 'Origin not allowed for this tenant' },
      { status: 403 }
    );
    return setCORSHeaders(errorResponse, null);
  }

  // Build the internal tenant API path
  const pathSegments = params.path;
  const internalPath = `/api/tenant/${pathSegments.join('/')}`;
  const targetUrl = new URL(internalPath, request.url);

  // Preserve query string natively using URLSearchParams constructor
  targetUrl.search = request.nextUrl.search;

  // Proxy the request to the internal path
  const headers = new Headers(request.headers);
  headers.set('X-NuCRM-Gateway-Tenant', resolution.tenantId);
  // Remove host header to avoid conflicts when making loopback fetch
  headers.delete('host');

  try {
    let body = undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = request.body; // Stream the body directly instead of fully buffering into a blob
    }

    // Explicitly casting the fetch options to bypass the duplex typing limitation in standard node fetch definitions,
    // which is safely supported in Next.js's patched fetch for streaming.
    const fetchOptions = {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      duplex: 'half'
    } as RequestInit;

    const proxyRes = await fetch(targetUrl.toString(), fetchOptions);

    const responseHeaders = new Headers(proxyRes.headers);

    const response = new NextResponse(proxyRes.body, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: responseHeaders,
    });

    return setCORSHeaders(response, origin);
  } catch (error) {
    const errorResponse = NextResponse.json(
      { error: 'Internal gateway error during proxy' },
      { status: 502 }
    );
    return setCORSHeaders(errorResponse, origin);
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const response = new NextResponse(null, { status: 204 });
  setCORSHeaders(response, origin);
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
}
