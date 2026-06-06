/**
 * GET    /api/tenant/documents/[id]  — metadata + signed download URL
 * DELETE /api/tenant/documents/[id]  — soft-delete row + remove S3 object
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { documents } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { getSignedUrl, deleteObject } from '@/lib/storage/s3';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await context.params;

  const [row] = await db
    .select({
      id: documents.id,
      tenantId: documents.tenantId,
      name: documents.name,
      s3Key: documents.s3Key,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      uploadedBy: documents.uploadedBy,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .limit(1);

  if (!row || row.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let downloadUrl: string;
  try {
    downloadUrl = await getSignedUrl(row.s3Key, 600);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not sign URL';
    console.error('[documents GET] sign failed', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({
    data: {
      id: row.id,
      name: row.name,
      storage_key: row.s3Key,
      mime_type: row.mimeType,
      size_bytes: row.sizeBytes,
      uploaded_by: row.uploadedBy,
      created_at: row.createdAt,
      download_url: downloadUrl,
      download_url_expires_in_seconds: 600,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await context.params;

  const [row] = await db
    .select({
      id: documents.id,
      tenantId: documents.tenantId,
      s3Key: documents.s3Key,
    })
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .limit(1);

  if (!row || row.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Best-effort S3 delete. If it fails we still soft-delete the row so
  // the user sees the document disappear from the UI; a future sweep
  // can collect orphans via the `deleted_at IS NOT NULL` filter.
  try {
    await deleteObject(row.s3Key);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'S3 delete failed';
    console.warn('[documents DELETE] s3 delete failed (soft-deleting row anyway)', msg);
  }

  await db
    .update(documents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(documents.id, id));

  return NextResponse.json({ ok: true });
}
