import { NextRequest, NextResponse } from 'next/server';
import { createGoogleCalendarProvider } from '@/lib/calendar-sync/google';
import { saveIntegrationConfig } from '@/lib/calendar-sync/service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL(`/tenant/calendar?error=${error}`, request.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/tenant/calendar?error=missing_code', request.url));
    }

    // Parse state: tenantId:userId:timestamp
    const [tenantId, userId] = state.split(':');
    if (!tenantId || !userId) {
      return NextResponse.redirect(new URL('/tenant/calendar?error=invalid_state', request.url));
    }

    const provider = createGoogleCalendarProvider();
    const tokens = await provider.exchangeCode(code, `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/tenant/calendar-sync/google/callback`);

    await saveIntegrationConfig(tenantId, userId, 'google', tokens);

    return NextResponse.redirect(new URL('/tenant/calendar?connected=google', request.url));
  } catch (err) {
    console.error('[google calendar callback]', err);
    return NextResponse.redirect(new URL('/tenant/calendar?error=callback_failed', request.url));
  }
}
