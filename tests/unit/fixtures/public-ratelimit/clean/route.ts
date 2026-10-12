// Fixture for scripts/check-public-rate-limit.mts (#2417). Never executed —
// the guard reads it as text and must report NOTHING here. This is the shape
// the real public routes are in: one limiter per handler, an explicit distinct
// action, before anything touches the database.
import { db } from '@/drizzle/db';
import { kbArticles } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(req: Request) {
  const limited = await checkRateLimit(req, { action: 'fixture-kb-list', max: 30, windowMinutes: 1 });
  if (limited) return limited;
  const rows = await db.select({ id: kbArticles.id }).from(kbArticles);
  return Response.json({ rows });
}

export async function POST(req: Request) {
  const limited = await checkRateLimit(req, { action: 'fixture-kb-detail', max: 10, windowMinutes: 1 });
  if (limited) return limited;
  const row = await db.query.kbArticles.findFirst({ where: eq(kbArticles.id, 'nope') });
  return Response.json({ row });
}
