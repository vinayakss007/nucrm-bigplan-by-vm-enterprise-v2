/**
 * POST /api/tenant/documents/upload-url
 *
 * Step 1 of the two-step direct-upload flow:
 *   1. Client POSTs { name, mime_type, size_bytes } here; server returns a
 *      presigned PUT URL plus the storage key it expects.
 *   2. Browser PUTs the bytes directly to S3 with that URL.
 *   3. Client POSTs { name, storage_key, mime_type, size_bytes } to
 *      /api/tenant/documents to create the metadata row.
 *
 * This route does NOT write to the database — only the metadata POST
 * does — so a failed/aborted upload leaves no orphan rows. Orphan S3
 * objects are cheap and can be swept later if the prefix grows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getSignedPutUrl } from '@/lib/storage/s3';
import { randomUUID } from 'crypto';

const MAX_FILE_BYTES = Number(process.env['DOCUMENT_MAX_BYTES'] ?? 100 * 1024 * 1024); // 100 MB default

const FORBIDDEN_MIME_PREFIXES = [
  'application/x-msdownload', // .exe
  'application/x-executable',
  'application/x-sh',
];

interface UploadUrlInput {
  name: string;
  mime_type: string;
  size_bytes: number;
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json().catch(() => null)) as UploadUrlInput | null;
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim() : '';
  const sizeBytes = Number(body.size_bytes);

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!mimeType) return NextResponse.json({ error: 'mime_type is required' }, { status: 400 });
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: 'size_bytes must be a positive integer' }, { status: 400 });
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        error: `File exceeds maximum size of ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`,
        limit_bytes: MAX_FILE_BYTES,
      },
      { status: 413 },
    );
  }
  if (FORBIDDEN_MIME_PREFIXES.some((p) => mimeType.toLowerCase().startsWith(p))) {
    return NextResponse.json(
      { error: 'Executable file types are not allowed' },
      { status: 415 },
    );
  }

  // Build a tenant-scoped storage key. Including the original extension
  // helps S3 console previews; the UUID prefix keeps keys collision-free.
  const ext = extractExtension(name);
  const storageKey = `documents/${ctx.tenantId}/${randomUUID()}${ext}`;

  let url: string;
  try {
    url = await getSignedPutUrl({
      key: storageKey,
      contentType: mimeType,
      contentLengthBytes: sizeBytes,
      expiresInSeconds: 600,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not sign upload URL';
    console.error('[documents/upload-url] sign failed', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({
    upload_url: url,
    storage_key: storageKey,
    expires_in_seconds: 600,
    required_headers: {
      'Content-Type': mimeType,
    },
  });
}

function extractExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  const ext = name.slice(dot).toLowerCase();
  // Reject anything weird in the extension (querystrings etc.)
  if (!/^\.[a-z0-9]{1,12}$/.test(ext)) return '';
  return ext;
}
