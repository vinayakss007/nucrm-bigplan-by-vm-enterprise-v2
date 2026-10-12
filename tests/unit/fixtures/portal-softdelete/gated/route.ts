// The read is unfiltered here but credited to a gate in ./gate-lib.ts — the
// shape #2380's fix has, and what the guard's `gate` exemption must accept.
import { db } from '@/drizzle/db';
import { documents } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { loadDocumentForSigner } from './gate-lib';

export async function GET(_req: Request) {
  const signed = await loadDocumentForSigner('nope');
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, signed.id),
  });
  return Response.json(doc);
}
