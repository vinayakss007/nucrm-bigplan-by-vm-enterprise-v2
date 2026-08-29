/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { documents, documentFolders } from '@/drizzle/schema/documents';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { getSignedPutUrl } from '@/lib/storage/s3';
import { getS3Config } from '@/lib/storage/s3-config';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { randomUUID } from 'crypto';
import { withApiRoute } from '@/lib/api/with-api-route';

// H-C: upload validation, mirroring app/api/tenant/documents/upload-url.
// Allowlist (not blocklist): anything not listed is rejected, preventing stored
// XSS via text/html, script-bearing SVG, executables, etc.
const MAX_FILE_BYTES = Number(process.env['DOCUMENT_MAX_BYTES'] ?? 100 * 1024 * 1024); // 100 MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/plain', 'text/csv', 'application/json', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/msword',
]);
const BLOCKED_EXTENSIONS = new Set([
  '.html', '.htm', '.svg', '.xhtml', '.exe', '.dll', '.bat', '.cmd',
  '.sh', '.ps1', '.js', '.mjs', '.php', '.jsp', '.asp', '.aspx', '.war',
]);

function extractExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  const ext = name.slice(dot).toLowerCase();
  if (!/^\.[a-z0-9]{1,12}$/.test(ext)) return '';
  return ext;
}

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'core-crm', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    const folderId = searchParams.get('folderId');

    // Pagination (#1324): bounded page size so the response can never be unbounded.
    const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '', 10) || 1);
    const limit = Math.min(Math.max(1, Number.parseInt(searchParams.get('limit') ?? '', 10) || 50), 200);

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [eq(documents.tenantId, ctx.tenantId)];

    if (entityType) filters.push(eq(documents.entityType, entityType));
    if (entityId) filters.push(eq(documents.entityId, entityId));
    if (folderId) {
      filters.push(eq(documents.folderId, folderId));
    } else if (!entityType) {
      filters.push(isNull(documents.folderId));
    }

    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(...filters));

    const docs = await db
      .select()
      .from(documents)
      .where(and(...filters))
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    // Also get folders at the same level
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folderFilters: any[] = [eq(documentFolders.tenantId, ctx.tenantId)];
    if (folderId) {
      folderFilters.push(eq(documentFolders.parentId, folderId));
    } else {
      folderFilters.push(isNull(documentFolders.parentId));
    }

    const folders = await db
      .select()
      .from(documentFolders)
      .where(and(...folderFilters))
      .orderBy(desc(documentFolders.createdAt));

    return NextResponse.json({ data: { documents: docs, folders }, page, limit, total: Number(countRow?.total ?? 0) });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'core-crm', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const body = await readJsonBody(req);
    const { name, mimeType, sizeBytes, folderId, entityType, entityId, createFolder } = body;

    // Handle folder creation
    if (createFolder) {
      if (!name) {
        return NextResponse.json({ error: 'name is required for folder creation' }, { status: 400 });
      }

      const [folder] = await db.insert(documentFolders).values({
        tenantId: ctx.tenantId,
        name,
        parentId: folderId || null,
      }).returning();

      return NextResponse.json({ data: { folder } }, { status: 201 });
    }

    // Handle document upload - generate presigned URL
    if (!name || !mimeType || !sizeBytes) {
      return NextResponse.json(
        { error: 'name, mimeType, and sizeBytes are required' },
        { status: 400 }
      );
    }

    // H-C: reject oversized / disallowed content types and dangerous
    // extensions so an attacker can't stage stored XSS (text/html, SVG) or
    // upload executables that later download inline via the signed URL.
    if (typeof sizeBytes !== 'number' || sizeBytes <= 0) {
      return NextResponse.json({ error: 'sizeBytes must be a positive number' }, { status: 400 });
    }
    if (sizeBytes > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds maximum size of ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`, limit_bytes: MAX_FILE_BYTES },
        { status: 413 },
      );
    }
    if (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return NextResponse.json(
        { error: `File type ${mimeType} is not allowed. Permitted: documents, images, archives.` },
        { status: 415 },
      );
    }
    const ext = extractExtension(String(name));
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: 'This file extension is not allowed for security reasons' },
        { status: 415 },
      );
    }

    // H-D: use the app's unified S3 config + user-files bucket so uploads and
    // the download route (lib/storage/s3.getSignedUrl) hit the SAME bucket.
    // The previous code uploaded to S3_DOCUMENTS_BUCKET via a separate client,
    // while downloads signed against getS3Config()'s bucket — so downloads
    // never resolved.
    const cfg = getS3Config();
    if (!cfg.configured || !cfg.bucket) {
      return NextResponse.json({ error: 'Document storage is not configured' }, { status: 503 });
    }
    const bucket = cfg.bucket;
    // UUID-prefixed, tenant-scoped, extension-preserving key (collision-free).
    const s3Key = `documents/${ctx.tenantId}/${randomUUID()}${ext}`;

    let uploadUrl: string;
    try {
      uploadUrl = await getSignedPutUrl({
        key: s3Key,
        contentType: mimeType,
        contentLengthBytes: sizeBytes,
        expiresInSeconds: 3600,
        bucket,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not sign upload URL';
      console.error('[documents POST] sign failed', msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    // Store document metadata
    const [doc] = await db.insert(documents).values({
      tenantId: ctx.tenantId,
      name,
      mimeType,
      sizeBytes,
      s3Key,
      s3Bucket: bucket,
      folderId: folderId || null,
      entityType: entityType || null,
      entityId: entityId || null,
      uploadedBy: ctx.userId,
    }).returning();

    return NextResponse.json({
      data: { document: doc, uploadUrl },
    }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

export const DELETE = withApiRoute(async (req: NextRequest) => {
  try {
  const limited = await rateLimitMutating(req, 'documents', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'core-crm', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    // Soft delete
    const [deleted] = await db.update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id, deleted: true } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});
