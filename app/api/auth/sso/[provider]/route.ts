import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { initiateSSO, handleSSOCallback } from '@/lib/auth/sso';

/**
 * GET /api/auth/sso/[provider] - Initiate SSO login
 * Redirects user to the identity provider.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenant_id');

    if (!tenantId) {
      return NextResponse.json(
        { error: 'tenant_id query parameter is required' },
        { status: 400 }
      );
    }

    const { redirectUrl, state } = await initiateSSO(tenantId, provider);

    // Set state in a cookie for CSRF protection on callback
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set('sso_state', state, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });
    response.cookies.set('sso_tenant_id', tenantId, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    return response;
  } catch (err: unknown) { return apiError(err); }
}

/**
 * POST /api/auth/sso/[provider] - Handle SSO callback
 * Validates assertion/code, creates session, redirects to app.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    const body = await req.json();
    const tenantId = req.cookies.get('sso_tenant_id')?.value || body.tenant_id;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'tenant_id is required' },
        { status: 400 }
      );
    }

    const result = await handleSSOCallback(tenantId, provider, {
      code: body.code,
      SAMLResponse: body.SAMLResponse,
      state: body.state,
    });

    // Clear SSO state cookies
    const response = NextResponse.json({
      data: {
        user_id: result.userId,
        session_id: result.sessionId,
        email: result.email,
      },
    });
    response.cookies.delete('sso_state');
    response.cookies.delete('sso_tenant_id');

    return response;
  } catch (err: unknown) { return apiError(err); }
}
