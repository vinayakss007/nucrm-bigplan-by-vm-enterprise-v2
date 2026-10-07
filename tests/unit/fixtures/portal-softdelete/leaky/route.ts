// Fixture for scripts/check-portal-soft-delete.mts (#2382). Never executed —
// the guard only reads this file as text, and it must report a violation here.
import { db } from '@/drizzle/db';
import { documents } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export async function GET(_req: Request) {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, 'nope'),
  });
  const tickets = await db.execute(sql`SELECT id FROM support_tickets WHERE tenant_id = $1`);
  return Response.json({ doc, tickets });
}
