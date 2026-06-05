/**
 * File Attachments API
 * POST /api/tenant/files  (multipart/form-data)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { fileAttachments, tenants, plans, users } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';

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

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const RESOURCE_TYPES = ['contact','deal','company','task','note'];

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { searchParams } = new URL(req.url);
    const resource_type = searchParams.get('resource_type');
    const resource_id   = searchParams.get('resource_id');
    if (!resource_type || !resource_id) return NextResponse.json({ error: 'resource_type and resource_id required' }, { status: 400 });

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
  } catch (err: any) {
    console.error('[files GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const formData = await req.formData();
    const file         = formData.get('file') as File | null;
    const resource_type = formData.get('resource_type') as string | null;
    const resource_id   = formData.get('resource_id') as string | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!resource_type || !RESOURCE_TYPES.includes(resource_type)) {
      return NextResponse.json({ error: `resource_type must be one of: ${RESOURCE_TYPES.join(', ')}` }, { status: 400 });
    }
    if (!resource_id) return NextResponse.json({ error: 'resource_id required' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File too large (max 25 MB)' }, { status: 413 });
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 415 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Check plan storage quota
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

    const storageType = 'local';

    const ext = extname(file.name).toLowerCase() || '.bin';
    const filename = `${randomBytes(16).toString('hex')}${ext}`;

    // Local storage (simplified for now)
    const uploadDir = join(process.cwd(), 'uploads', ctx.tenantId, resource_type, resource_id);
    await mkdir(uploadDir, { recursive: true });
    const localPath = join(uploadDir, filename);
    await writeFile(localPath, buffer);
    const storagePath = `uploads/${ctx.tenantId}/${resource_type}/${resource_id}/${filename}`;

    // Save to DB in transaction
    const attachment = await db.transaction(async (tx) => {
      const [newAttachment] = await tx.insert(fileAttachments)
        .values({
          tenantId: ctx.tenantId,
          uploadedBy: ctx.userId,
          entityType: resource_type,
          entityId: resource_id,
          fileName: file.name.slice(0, 255),
          filePath: storagePath,
          fileSize: file.size,
          mimeType: file.type,
        })
        .returning();

      if (!newAttachment) {
        throw new Error('Failed to create file attachment record');
      }

      // Update storage usage
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
  } catch (err: any) {
    console.error('[files POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const file = await db.query.fileAttachments.findFirst({
      where: and(eq(fileAttachments.id, id), eq(fileAttachments.tenantId, ctx.tenantId))
    });

    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.transaction(async (tx) => {
      // Delete from DB
      await tx.delete(fileAttachments).where(eq(fileAttachments.id, id));
      
      // Update storage usage
      await tx.update(tenants)
        .set({ storageUsedBytes: sql`GREATEST(0, ${tenants.storageUsedBytes} - ${file.fileSize || 0})` })
        .where(eq(tenants.id, ctx.tenantId));
    });

    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'delete', entityType:'file', entityId: id });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[files DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
