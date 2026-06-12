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
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const uploadUrlSchema = z.object({
  name: z.string().min(1, 'name is required'),
  mime_type: z.string().min(1, 'mime_type is required'),
  size_bytes: z.number().positive('size_bytes must be a positive integer'),
});

const MAX_FILE_BYTES = Number(process.env['DOCUMENT_MAX_BYTES'] ?? 100 * 1024 * 1024); // 100 MB default

const FORBIDDEN_MIME_PREFIXES = [
  'application/x-msdownload', // .exe
  'application/x-executable',
  'application/x-sh',
];

export async function POST(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const raw = await request.json().catch(e => { console.error('[upload-url]', e); return null; });
  const parsed = validateBody(uploadUrlSchema, raw);
  if (parsed instanceof NextResponse) return parsed;
  const { name: nameRaw, mime_type: mimeType, size_bytes: sizeBytes } = parsed.data;
  const name = nameRaw.trim();

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
