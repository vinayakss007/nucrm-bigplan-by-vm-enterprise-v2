import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const REQUEST_ID_HEADER = 'x-request-id';

export function getRequestId(request: NextRequest): string {
  return request.headers.get(REQUEST_ID_HEADER) || uuidv4();
}

export function addRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function createResponseWithRequestId(
  data: any,
  requestId: string,
  status = 200
): NextResponse {
  const response = NextResponse.json(data, { status });
  return addRequestId(response, requestId);
}

export function createErrorResponseWithRequestId(
  error: string,
  requestId: string,
  status = 500,
  code?: string
): NextResponse {
  const response = NextResponse.json(
    { 
      error,
      code: code || 'ERR_INTERNAL',
      requestId 
    },
    { status }
  );
  return addRequestId(response, requestId);
}

export interface RequestContext {
  requestId: string;
  startTime: number;
}

export function startRequestTracking(request: NextRequest): RequestContext {
  return {
    requestId: getRequestId(request),
    startTime: Date.now(),
  };
}

export function logRequestMetrics(
  ctx: RequestContext,
  method: string,
  path: string,
  status: number
) {
  const duration = Date.now() - ctx.startTime;
  console.log(
    JSON.stringify({
      type: 'api_metrics',
      requestId: ctx.requestId,
      method,
      path,
      status,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    })
  );
}