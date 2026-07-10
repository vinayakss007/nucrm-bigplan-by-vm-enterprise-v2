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

// Extension → MIME type mapping for server-side validation
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

// Magic bytes → MIME type detection (first 8 bytes)
function detectMimeFromBuffer(buf: Buffer): string | null {
  const head = buf.subarray(0, 8);
  // JPEG: FF D8 FF
  if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return 'image/gif';
  // WebP: RIFF....WEBP
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp';
  // PDF: 25 50 44 46
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'application/pdf';
  // DOCX/XLSX/PPTX: PK (ZIP) — check extension later
  if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) return 'application/zip';
  // DOC: D0 CF 11 E0 (OLE2)
  if (head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0) return 'application/msword';
  // Plain text / CSV: heuristic — no binary marker in first 8 bytes
  if (buf.length > 0) {
    let isText = true;
    for (let i = 0; i < Math.min(buf.length, 512); i++) {
      const c = buf[i];
      if (c === 0) { isText = false; break; }
    }
    if (isText) return 'text/plain';
  }
  return null;
}

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

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // --- Server-side MIME detection (magic bytes + extension) ---
    const ext = extname(file.name).toLowerCase();
    const detectedMime = detectMimeFromBuffer(buffer);
    const extensionMime = EXT_MIME_MAP[ext];

    // Resolve MIME: prefer magic-byte detection, fall back to extension map
    let finalMime: string | null = detectedMime;

    // For ZIP-based Office formats, trust extension (magic bytes only say "zip")
    if (detectedMime === 'application/zip' && extensionMime) {
      finalMime = extensionMime;
    }

    // If magic-byte detection failed, try extension map
    if (!finalMime && extensionMime) {
      finalMime = extensionMime;
    }

    // Reject if detected MIME is not in allowlist
    if (!finalMime || !ALLOWED_TYPES.has(finalMime)) {
      return NextResponse.json(
        { error: 'File type not allowed', detected: finalMime || 'unknown' },
        { status: 415 }
      );
    }

    // Reject dangerous extensions even if MIME matches
    const DANGEROUS_EXTS = new Set(['.exe','.bat','.cmd','.com','.msi','.scr','.pif','.vbs','.js','.ws','.wsf','.ps1','.sh','.bash','.csh','.ksh','.rb','.py','.pl','.php','.jsp','.asp','.aspx','.jar','.class','.war','.ear','.dll','.so','.dylib','.bin','.cmd','.com','.scr','.pif']);
    if (DANGEROUS_EXTS.has(ext)) {
      return NextResponse.json({ error: 'File extension not allowed' }, { status: 415 });
    }

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

    const _storageType = 'local';

    const filename = `${randomBytes(16).toString('hex')}${ext || '.bin'}`;

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
          mimeType: finalMime,
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[files DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
