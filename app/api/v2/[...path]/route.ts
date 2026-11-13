/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayTenant, validateCORS } from "@/lib/api/gateway";
import { SUNSET_DATE } from "@/lib/api/deprecation";

/**
 * Catch-all handler for /api/v2/*
 *
 * #3504 / PR-7A: /api/v2 is deprecated and redirects cleanly to /api/tenant/*.
 * The previous implementation was an internal HTTP loopback proxy that re-fetched
 * internal routes over HTTP. That introduced latency, connection overhead,
 * header forwarding vulnerabilities, and redundant rate-limit / auth evaluation.
 *
 * Routes are now redirected cleanly (308 for GET/HEAD, 307 for mutating methods)
 * with standard IETF deprecation/sunset headers, preserving query parameters and CORS.
 */

function setCORSHeaders(
  response: NextResponse,
  origin: string | null,
): NextResponse {
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Tenant-ID, X-Requested-With",
  );
  response.headers.set("Vary", "Origin");
  return response;
}

async function handleRequest(
  request: NextRequest,
  params: { path: string[] },
): Promise<NextResponse> {
  const origin = request.headers.get("origin");

  // Resolve tenant from gateway
  const resolution = await resolveGatewayTenant(request);
  if (!resolution) {
    // #1156: return a generic 401 — do not enumerate the tenant-resolution
    // methods (API key / X-Tenant-ID / custom domain), which aided attackers
    // in mapping the auth architecture.
    const errorResponse = NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    return setCORSHeaders(errorResponse, origin);
  }

  // Validate CORS for the resolved tenant
  const corsValid = await validateCORS(origin, resolution.tenantId);
  if (!corsValid) {
    const errorResponse = NextResponse.json(
      { error: "Origin not allowed for this tenant" },
      { status: 403 },
    );
    return setCORSHeaders(errorResponse, null);
  }

  // Build the target tenant API path
  const pathSegments = params.path;
  const internalPath = `/api/tenant/${pathSegments.join("/")}`;
  const targetUrl = new URL(internalPath, request.url);

  // Preserve query string natively using URLSearchParams constructor
  targetUrl.search = request.nextUrl.search;

  // #3504: Clean redirect rather than internal loopback fetch.
  // Preserves HTTP verb semantics (308 for GET/HEAD, 307 for mutating methods).
  const redirectStatus =
    request.method === "GET" || request.method === "HEAD" ? 308 : 307;
  const response = NextResponse.redirect(targetUrl, {
    status: redirectStatus,
    headers: {
      Deprecation: "true",
      Sunset: new Date(`${SUNSET_DATE}T23:59:59Z`).toUTCString(),
      Link: `<${internalPath}>; rel="successor-version"`,
      "X-Deprecation-Notice": `The /api/v2 loopback proxy is deprecated. Call ${internalPath} directly.`,
    },
  });

  return setCORSHeaders(response, origin);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const params = await context.params;
  return handleRequest(request, params);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const response = new NextResponse(null, { status: 204 });
  setCORSHeaders(response, origin);
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}
