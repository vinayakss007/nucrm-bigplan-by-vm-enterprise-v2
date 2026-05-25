/**
 * GET  /api/tenant/documents     — list documents for the workspace
 * POST /api/tenant/documents     — record metadata after a successful upload
 *
 * Pairs with /upload-url. The two-step pattern means a failed upload
 * never leaves a metadata row behind.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { documents, users } from '@/drizzle/schema';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

const ALLOWED_ENTITY_TYPES = new Set(['contact', 'deal', 'company', 'lead', 'ticket']);

interface CreateInput {
  name: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  description?: string | null;
  tags?: string[] | null;
  linked_entity_type?: string | null;
  linked_entity_id?: string | null;
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const entityType = url.searchParams.get('linked_entity_type');
  const entityId = url.searchParams.get('linked_entity_id');
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const filters = [eq(documents.tenantId, ctx.tenantId), isNull(documents.deletedAt)];
  if (q) {
    filters.push(or(ilike(documents.name, `%${q}%`), ilike(documents.description, `%${q}%`))!);
  }
  if (entityType && ALLOWED_ENTITY_TYPES.has(entityType)) {
    filters.push(eq(documents.linkedEntityType, entityType));
  }
  if (entityId) {
    filters.push(eq(documents.linkedEntityId, entityId));
  }

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(...filters));
  const count = countRows[0]?.count ?? 0;

  const rows = await db
    .select({
      id: documents.id,
      name: documents.name,
      storageKey: documents.storageKey,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      description: documents.description,
      tags: documents.tags,
      linkedEntityType: documents.linkedEntityType,
      linkedEntityId: documents.linkedEntityId,
      uploadedBy: documents.uploadedBy,
      uploadedByName: users.fullName,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(and(...filters))
    .orderBy(desc(documents.createdAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      storage_key: r.storageKey,
      mime_type: r.mimeType,
      size_bytes: r.sizeBytes,
      description: r.description,
      tags: r.tags,
      linked_entity_type: r.linkedEntityType,
      linked_entity_id: r.linkedEntityId,
      uploaded_by: r.uploadedBy,
      uploaded_by_name: r.uploadedByName,
      created_at: r.createdAt,
    })),
    total: count,
    limit,
    offset,
  });
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json().catch(() => null)) as CreateInput | null;
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const storageKey = typeof body.storage_key === 'string' ? body.storage_key.trim() : '';
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim() : '';
  const sizeBytes = Number(body.size_bytes);

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!storageKey) return NextResponse.json({ error: 'storage_key is required' }, { status: 400 });
  if (!mimeType) return NextResponse.json({ error: 'mime_type is required' }, { status: 400 });
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: 'size_bytes must be a positive integer' }, { status: 400 });
  }

  // Defence in depth: the storage key must live under this tenant's prefix.
  // The upload-url endpoint always issues keys of the form
  //   documents/<tenantId>/<uuid>.ext
  // so a malicious client can't claim ownership of someone else's blob.
  const expectedPrefix = `documents/${ctx.tenantId}/`;
  if (!storageKey.startsWith(expectedPrefix)) {
    return NextResponse.json(
      { error: 'storage_key does not belong to this workspace' },
      { status: 400 },
    );
  }

  const linkedEntityType =
    body.linked_entity_type && ALLOWED_ENTITY_TYPES.has(body.linked_entity_type)
      ? body.linked_entity_type
      : null;
  const linkedEntityId =
    linkedEntityType && typeof body.linked_entity_id === 'string'
      ? body.linked_entity_id
      : null;

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 32)
    : [];

  let inserted;
  try {
    [inserted] = await db
      .insert(documents)
      .values({
        tenantId: ctx.tenantId,
        name,
        storageKey,
        mimeType,
        sizeBytes,
        description: body.description?.toString().trim() || null,
        tags,
        linkedEntityType,
        linkedEntityId,
        uploadedBy: ctx.userId,
      })
      .returning({
        id: documents.id,
        name: documents.name,
        storageKey: documents.storageKey,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Insert failed';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json(
        { error: 'A document with this storage_key already exists' },
        { status: 409 },
      );
    }
    throw err;
  }

  if (!inserted) return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  return NextResponse.json(
    {
      data: {
        id: inserted.id,
        name: inserted.name,
        storage_key: inserted.storageKey,
        mime_type: inserted.mimeType,
        size_bytes: inserted.sizeBytes,
        created_at: inserted.createdAt,
      },
    },
    { status: 201 },
  );
}
