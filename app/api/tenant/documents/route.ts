import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { documents, documentFolders } from '@/drizzle/schema/documents';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: process.env['AWS_REGION'] || 'us-east-1',
  credentials: process.env['AWS_ACCESS_KEY_ID'] ? {
    accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
  } : undefined,
});

const BUCKET = process.env['S3_DOCUMENTS_BUCKET'] || 'nucrm-documents';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'core-crm');
    if (moduleGate) return moduleGate;

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    const folderId = searchParams.get('folderId');

    const filters: any[] = [eq(documents.tenantId, ctx.tenantId)];

    if (entityType) filters.push(eq(documents.entityType, entityType));
    if (entityId) filters.push(eq(documents.entityId, entityId));
    if (folderId) {
      filters.push(eq(documents.folderId, folderId));
    } else if (!entityType) {
      filters.push(isNull(documents.folderId));
    }

    const docs = await db
      .select()
      .from(documents)
      .where(and(...filters))
      .orderBy(desc(documents.createdAt));

    // Also get folders at the same level
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

    return NextResponse.json({ data: { documents: docs, folders } });
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'core-crm');
    if (moduleGate) return moduleGate;

    const body = await req.json();
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

    const s3Key = `${ctx.tenantId}/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // Generate presigned URL for direct client upload
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    });

    const uploadUrl = await getSignedUrl(s3 as any, command, { expiresIn: 3600 });

    // Store document metadata
    const [doc] = await db.insert(documents).values({
      tenantId: ctx.tenantId,
      name,
      mimeType,
      sizeBytes,
      s3Key,
      s3Bucket: BUCKET,
      folderId: folderId || null,
      entityType: entityType || null,
      entityId: entityId || null,
      uploadedBy: ctx.userId,
    }).returning();

    return NextResponse.json({
      data: { document: doc, uploadUrl },
    }, { status: 201 });
  } catch (err: any) { return apiError(err); }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'core-crm');
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
  } catch (err: any) { return apiError(err); }
}
