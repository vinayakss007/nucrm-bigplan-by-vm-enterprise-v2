// Mirror of ./leaky/route.ts with the tombstone tested in both reads. The
// guard must report nothing here — this is the known-good half of the test.
import { db } from '@/drizzle/db';
import { documents } from '@/drizzle/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';

export async function GET(_req: Request) {
  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.id, 'nope'), isNull(documents.deletedAt)),
  });
  const tickets = await db
    .execute(sql`SELECT id FROM support_tickets WHERE tenant_id = $1 AND deleted_at IS NULL`);
  return Response.json({ doc, tickets });
}
