// Fixture for scripts/check-public-rate-limit.mts (#2417). Never executed —
// the guard reads it as text. The limiter is present but runs AFTER the query,
// which throttles the answer instead of the work: the request has already paid
// for a database round-trip by the time it is refused.
import { db } from '@/drizzle/db';
import { kbArticles } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(req: Request) {
  const row = await db.query.kbArticles.findFirst({ where: eq(kbArticles.id, 'nope') });
  const limited = await checkRateLimit(req, { action: 'fixture-late', max: 30, windowMinutes: 1 });
  if (limited) return limited;
  return Response.json({ row });
}
