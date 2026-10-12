// Fixture for scripts/check-public-rate-limit.mts (#2417). Never executed —
// the guard reads it as text. Both handlers are limited, early, and with an
// explicit action, so nothing else fires: they just share one action string,
// which means they share the v1_rate:${action}:${ip} bucket. Reading the page
// then spends the write's budget — the failure mode #2383 called out for CSAT.
import { db } from '@/drizzle/db';
import { kbArticles } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolvePortalIdentity } from '@/lib/portal-auth';

export async function GET(req: Request) {
  const limited = await checkRateLimit(req, { action: 'fixture-shared', max: 60, windowMinutes: 5 });
  if (limited) return limited;
  const identity = await resolvePortalIdentity(req as never);
  const row = await db.query.kbArticles.findFirst({ where: eq(kbArticles.id, String(identity?.tenantId ?? '')) });
  return Response.json({ row });
}

export async function POST(req: Request) {
  const limited = await checkRateLimit(req, { action: 'fixture-shared', max: 5, windowMinutes: 60 });
  if (limited) return limited;
  const rows = await db.select({ id: kbArticles.id }).from(kbArticles);
  return Response.json({ rows });
}
