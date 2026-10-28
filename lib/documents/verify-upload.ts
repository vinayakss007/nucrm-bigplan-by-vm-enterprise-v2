/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3297 — the client half of the storage meter.
 *
 * `POST /api/tenant/documents` records the row and hands back a presigned PUT with
 * `size_bytes` set to whatever this browser declared in the JSON body. The bytes
 * land afterwards, directly at the store, and nothing on that path knows whether
 * the number in the row still means anything. So every uploader that PUTs to a
 * presigned URL has to settle the row once the PUT returns — otherwise the endpoint
 * exists and is reached by nobody, which is the shape #3298 was about: a control
 * only some callers reach reads as working while the meter keeps lying.
 *
 * The settle is deliberately not allowed to fail an upload. A measurement round trip
 * that errors leaves the file exactly where the user put it and the row exactly as
 * unverified as it was before this change; the alternative — telling the user their
 * upload failed when it succeeded — is worse. The exception is 413 and 410, where
 * the server removed the document, because there the upload genuinely did not stick.
 */
export interface VerifyUploadOutcome {
  status: number;
  /** Bytes the row claimed before this call. */
  declaredBytes?: number;
  /** Bytes the store reported. Absent when nothing could be measured. */
  measuredBytes?: number;
  /** True when the stored number was rewritten to the measured one. */
  adjusted: boolean;
  /** Whether the document survived the settle. */
  removed: boolean;
  error?: string;
}

/**
 * Settle one just-uploaded document against the object the store actually holds.
 * Never throws: the caller has no recovery action for a failed measurement, and the
 * upload it is reporting on already happened.
 */
export async function verifyUploadedDocument(documentId: string): Promise<VerifyUploadOutcome> {
  try {
    const res = await fetch(`/api/tenant/documents/${documentId}/verify`, { method: 'POST' });
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    const data = (body.data ?? body) as Record<string, number | boolean | string>;
    return {
      status: res.status,
      adjusted: data.adjusted === true,
      declaredBytes: typeof data.declaredBytes === 'number' ? data.declaredBytes : undefined,
      measuredBytes: typeof data.measuredBytes === 'number' ? data.measuredBytes : undefined,
      removed: res.status === 413 || res.status === 410 || body.removed === true,
      error: typeof body.error === 'string' ? body.error : undefined,
    };
  } catch {
    return { status: 0, adjusted: false, removed: false };
  }
}
