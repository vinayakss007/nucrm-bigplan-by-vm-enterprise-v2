import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { createChatSession } from '@/lib/chat';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireModule } from '@/lib/modules/gate';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';

/**
 * Public Chat Widget Endpoint
 *
 * No auth required - designed for embeddable chat widget on external sites.
 * Tenant is identified via query parameter or API key.
 */

const createVisitorSessionSchema = z.object({
  visitorId: z.string().min(1),
  tenantId: z.string().uuid(),
  visitorName: z.string().optional(),
  visitorEmail: z.string().email().optional(),
});

/**
 * GET - Returns widget configuration (colors, greeting message, position).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // Return default widget config (can be customized per tenant later)
    const config = {
      tenantId,
      greeting: 'Hi! How can we help you today?',
      position: 'bottom-right',
      primaryColor: '#2563eb',
      bubbleColor: '#1d4ed8',
      textColor: '#ffffff',
      offlineMessage: 'We are currently offline. Leave a message and we will get back to you.',
      requireEmail: false,
    };

    return NextResponse.json({ data: config });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * POST - Create a visitor chat session (public, no auth).
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit public endpoint
    const rateLimited = checkPublicRateLimit(req, { max: 100, windowMs: 60_000, prefix: 'chat-widget' });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const validated = validateBody(createVisitorSessionSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Verify tenant has the service-helpdesk module enabled
    const moduleGate = await requireModule(v.tenantId, 'service-helpdesk');
    if (moduleGate) return moduleGate;

    const session = await createChatSession({
      visitorId: v.visitorId,
      tenantId: v.tenantId,
      visitorName: v.visitorName,
      visitorEmail: v.visitorEmail,
      channel: 'widget',
    });

    return NextResponse.json({ data: session }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
