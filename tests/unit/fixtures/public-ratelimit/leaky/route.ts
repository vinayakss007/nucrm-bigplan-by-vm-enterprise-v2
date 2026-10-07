// Fixture for scripts/check-public-rate-limit.mts (#2417). Never executed —
// the guard only reads this file as text, and it must report violations here:
// an unthrottled GET, and a POST whose limiter omits `action` (so it would
// silently pool into the shared 'api' bucket).
import { db } from '@/drizzle/db';
import { kbArticles } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(_req: Request) {
  const row = await db.query.kbArticles.findFirst({ where: eq(kbArticles.id, 'nope') });
  return Response.json({ row });
}

export async function POST(req: Request) {
  const limited = await checkRateLimit(req, { max: 10, windowMinutes: 1 });
  if (limited) return limited;
  const rows = await db.select({ id: kbArticles.id }).from(kbArticles);
  return Response.json({ rows });
}
