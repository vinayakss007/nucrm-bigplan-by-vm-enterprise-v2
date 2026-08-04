/**
 * File Attachments API
 * POST /api/tenant/files  (multipart/form-data) — upload to S3
 * GET  /api/tenant/files?id=... — presigned download URL
 * GET  /api/tenant/files?resource_type=...&resource_id=... — list attachments
 * DELETE /api/tenant/files?id=... — delete from S3 + DB
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { fileAttachments, tenants, plans, users } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { uploadFileToS3, getSignedUrl, deleteObject } from '@/lib/storage/s3';
import { isS3Configured } from '@/lib/storage/s3-config';

const ALLOWED_TYPES = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv',
]);

const EXT_MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv',
};

function detectMimeFromBuffer(buf: Buffer): string | null {
  const head = buf.subarray(0, 8);
  if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'image/jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) return 'image/png';
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return 'image/gif';
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp';
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'application/pdf';
  if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) return 'application/zip';
  if (head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0) return 'application/msword';
  if (buf.length > 0) {
    let isText = true;
    for (let i = 0; i < Math.min(buf.length, 512); i++) {
      if (buf[i] === 0) { isText = false; break; }
    }
    if (isText) return 'text/plain';
  }
  return null;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const RESOURCE_TYPES = ['contact','deal','company','task','note'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { searchParams } = new URL(req.url);

    // GET by id → presigned download URL
    const id = searchParams.get('id');
    if (id) {
      if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id format' }, { status: 400 });

      const file = await db.query.fileAttachments.findFirst({
        where: and(eq(fileAttachments.id, id), eq(fileAttachments.tenantId, ctx.tenantId)),
      });
      if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      if (!isS3Configured()) {
        return NextResponse.json({ error: 'S3 storage not configured' }, { status: 503 });
      }

      const url = await getSignedUrl(file.filePath, 3600);
      return NextResponse.json({ data: { url, expires_in: 3600, mime_type: file.mimeType, file_name: file.fileName } });
    }

    // List by resource
    const resource_type = searchParams.get('resource_type');
    const resource_id   = searchParams.get('resource_id');
    if (!resource_type || !resource_id) return NextResponse.json({ error: 'resource_type and resource_id required' }, { status: 400 });
    if (!UUID_RE.test(resource_id)) return NextResponse.json({ error: 'Invalid resource_id format' }, { status: 400 });

    const files = await db
      .select({
        id: fileAttachments.id,
        filename: fileAttachments.fileName,
        original_name: fileAttachments.fileName,
        mime_type: fileAttachments.mimeType,
        size_bytes: fileAttachments.fileSize,
        created_at: fileAttachments.createdAt,
        uploaded_by_name: users.fullName
      })
      .from(fileAttachments)
      .leftJoin(users, eq(users.id, fileAttachments.uploadedBy))
      .where(and(
        eq(fileAttachments.tenantId, ctx.tenantId),
        eq(fileAttachments.entityType, resource_type),
        eq(fileAttachments.entityId, resource_id)
      ))
      .orderBy(desc(fileAttachments.createdAt));

    return NextResponse.json({ data: files });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[files GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    if (!isS3Configured()) {
      return NextResponse.json({ error: 'S3 storage not configured' }, { status: 503 });
    }

    const formData = await req.formData();
    const file         = formData.get('file') as File | null;
    const resource_type = formData.get('resource_type') as string | null;
    const resource_id   = formData.get('resource_id') as string | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!resource_type || !RESOURCE_TYPES.includes(resource_type)) {
      return NextResponse.json({ error: `resource_type must be one of: ${RESOURCE_TYPES.join(', ')}` }, { status: 400 });
    }
    if (!resource_id) return NextResponse.json({ error: 'resource_id required' }, { status: 400 });
    if (!UUID_RE.test(resource_id)) return NextResponse.json({ error: 'Invalid resource_id format' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File too large (max 25 MB)' }, { status: 413 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const ext = extname(file.name).toLowerCase();
    const detectedMime = detectMimeFromBuffer(buffer);
    const extensionMime = EXT_MIME_MAP[ext];

    let finalMime: string | null = detectedMime;
    if (detectedMime === 'application/zip' && extensionMime) finalMime = extensionMime;
    if (!finalMime && extensionMime) finalMime = extensionMime;

    if (!finalMime || !ALLOWED_TYPES.has(finalMime)) {
      return NextResponse.json({ error: 'File type not allowed', detected: finalMime || 'unknown' }, { status: 415 });
    }

    const DANGEROUS_EXTS = new Set(['.exe','.bat','.cmd','.com','.msi','.scr','.pif','.vbs','.js','.ws','.wsf','.ps1','.sh','.bash','.csh','.ksh','.rb','.py','.pl','.php','.jsp','.asp','.aspx','.jar','.class','.war','.ear','.dll','.so','.dylib','.bin']);
    if (DANGEROUS_EXTS.has(ext)) {
      return NextResponse.json({ error: 'File extension not allowed' }, { status: 415 });
    }

    const [tenantWithPlan] = await db
      .select({
        storageUsedBytes: tenants.storageUsedBytes,
        maxStorageGb: plans.maxStorageGb
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    const usedGb = (Number(tenantWithPlan?.storageUsedBytes) ?? 0) / (1024 ** 3);
    const maxGb = Number(tenantWithPlan?.maxStorageGb) ?? 0;
    if (tenantWithPlan && maxGb > 0 && usedGb >= maxGb) {
      return NextResponse.json({ error: `Storage limit (${maxGb} GB) reached. Upgrade your plan.` }, { status: 403 });
    }

    const s3Key = `${ctx.tenantId}/${resource_type}/${resource_id}/${randomBytes(16).toString('hex')}${ext || '.bin'}`;
    await uploadFileToS3(buffer, s3Key, finalMime);

    const attachment = await db.transaction(async (tx) => {
      const [newAttachment] = await tx.insert(fileAttachments)
        .values({
          tenantId: ctx.tenantId,
          uploadedBy: ctx.userId,
          entityType: resource_type,
          entityId: resource_id,
          fileName: file.name.slice(0, 255),
          filePath: s3Key,
          fileSize: file.size,
          mimeType: finalMime,
        })
        .returning();

      if (!newAttachment) throw new Error('Failed to create file attachment record');

      await tx.update(tenants)
        .set({ storageUsedBytes: sql`${tenants.storageUsedBytes} + ${file.size}` })
        .where(eq(tenants.id, ctx.tenantId));

      return newAttachment;
    });

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'upload', entityType: 'file', entityId: attachment.id,
      newData: { original_name: file.name, size: file.size, resource_type, resource_id },
    });

    return NextResponse.json({ data: attachment }, { status: 201 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[files POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const limited = await rateLimitMutating(req, 'documents', 'delete');
    if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id format' }, { status: 400 });

    const file = await db.query.fileAttachments.findFirst({
      where: and(eq(fileAttachments.id, id), eq(fileAttachments.tenantId, ctx.tenantId))
    });

    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Delete from S3
    if (isS3Configured()) {
      try {
        await deleteObject(file.filePath);
      } catch (e) {
        console.error('[files DELETE] S3 delete failed, continuing with DB cleanup:', e);
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(fileAttachments).where(eq(fileAttachments.id, id));
      await tx.update(tenants)
        .set({ storageUsedBytes: sql`GREATEST(0, ${tenants.storageUsedBytes} - ${file.fileSize || 0})` })
        .where(eq(tenants.id, ctx.tenantId));
    });

    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'delete', entityType:'file', entityId: id });
    return NextResponse.json({ ok: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[files DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
