import { db } from '@/drizzle/db';
import { documents } from '@/drizzle/schema';
import { and, eq, isNull } from 'drizzle-orm';

export async function loadDocumentForSigner(id: string) {
  return db.query.documents.findFirst({
    where: and(eq(documents.id, id), isNull(documents.deletedAt)),
  });
}
