// Same exported name as ./gate-lib.ts, predicate removed — the guard must
// report this exemption as stale instead of letting the route pass on paper.
import { db } from '@/drizzle/db';
import { documents } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function loadDocumentForSigner(id: string) {
  return db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
}
