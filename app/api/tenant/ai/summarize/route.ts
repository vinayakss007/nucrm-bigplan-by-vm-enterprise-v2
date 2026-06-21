import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantModules } from '@/drizzle/schema/modules';
import { eq, and } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import { GatewayError } from '@/lib/ai/gateway';
import { summarizeEntity, type SummarizeEntityType } from '@/lib/ai/summarize';

interface PostBody {
  entity_type?: string;
  entity_id?: string;
  custom_instructions?: string;
}

function isSummarizeEntityType(s: unknown): s is SummarizeEntityType {
  return s === 'contact' || s === 'deal' || s === 'company';
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await checkRateLimit(req, { action: 'ai_summarize', max: 30, windowMinutes: 60 });
    if (limited) return limited;

    const moduleInstalled = await db.query.tenantModules.findFirst({
      where: and(
        eq(tenantModules.tenantId, ctx.tenantId),
        eq(tenantModules.moduleId, 'ai-assistant'),
        eq(tenantModules.status, 'active'),
      ),
    });
    if (!moduleInstalled) {
      return NextResponse.json({
        error: 'AI Assistant module not installed. Install it from Settings → Modules.',
      }, { status: 403 });
    }

    let body: PostBody;
    try { body = await req.json() as PostBody; } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    if (!isSummarizeEntityType(body.entity_type)) {
      return NextResponse.json({ error: 'entity_type must be contact, deal or company' }, { status: 400 });
    }
    if (typeof body.entity_id !== 'string' || body.entity_id.length < 8) {
      return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
    }

    let result;
    try {
      result = await summarizeEntity(
        ctx.tenantId,
        ctx.userId,
        body.entity_type,
        body.entity_id,
        body.custom_instructions,
      );
    } catch (err) {
      if (err instanceof GatewayError) {
        const status = err.code === 'no_provider_enabled' || err.code === 'no_key_for_provider' ? 503 : 502;
        return NextResponse.json({ error: err.message, code: err.code }, { status });
      }
      throw err;
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[ai/summarize POST]', err);
    return apiError(err);
  }
}
