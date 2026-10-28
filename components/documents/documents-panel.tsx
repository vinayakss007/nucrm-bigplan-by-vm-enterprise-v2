/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

/**
 * Reusable documents panel for record-detail pages.
 *
 * Drop into any deal/contact/company/lead/ticket detail screen with:
 *
 *   <DocumentsPanel entityType="deal" entityId={deal.id} />
 *
 * The panel manages its own list, drag-and-drop upload, download, and
 * delete via the same /api/tenant/documents endpoints the standalone
 * /tenant/documents page uses, but every uploaded document is
 * pre-linked to the supplied entity so it shows up here on subsequent
 * visits.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { verifyUploadedDocument } from '@/lib/documents/verify-upload';
import toast from 'react-hot-toast';
import pLimit from 'p-limit';

export type DocumentEntityType = 'contact' | 'deal' | 'company' | 'lead' | 'ticket';

/** The keys `GET /api/tenant/documents` actually answers with: a raw
 *  `db.select().from(documents)` row (`app/api/tenant/documents/route.ts:82-88`), so
 *  Drizzle column properties, camelCase — and no uploader, which the list route never
 *  joins (#2782). */
interface DocumentRow {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

interface Props {
  entityType: DocumentEntityType;
  entityId: string;
  /** Hide the upload zone (e.g. for read-only viewers). */
  readOnly?: boolean;
}

export default function DocumentsPanel({ entityType, entityId, readOnly = false }: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      // #2782 — `route.ts:57-59` reads `entityType` / `entityId` / `folderId` and
      // nothing else, so the `linked_entity_*` names this used to send matched no
      // filter: `:73-75` then fell through to `isNull(folder_id)` and answered the
      // whole tenant's loose files on a single deal's page.
      const params = new URLSearchParams({
        entityType,
        entityId,
      });
      const res = await fetch(`/api/tenant/documents?${params}`, { signal });
      const json = await res.json();
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(json.error || 'Failed to load documents');
      // The envelope is `{ data: { documents, folders }, page, limit, total }`
      // (`route.ts:106`), the same one `app/tenant/documents/page.tsx:52-53` reads.
      setDocs(json.data?.documents ?? []);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      if (signal?.aborted) return;
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // #2782 — one round trip, the way `app/tenant/documents/page.tsx:77-95` uploads.
  // The two-step flow this replaced signed a PUT through `/upload-url`, then POSTed
  // metadata as `{ name, storage_key, mime_type, size_bytes }`; `route.ts:139-144`
  // requires `mimeType` and `sizeBytes` and answered 400 every time, so no upload
  // from this panel could complete. It also ignores `storage_key` and generates its
  // own key (`route.ts:191`), so even a body that passed validation would have
  // recorded a row pointing at bytes nobody uploaded.
  const uploadFile = async (file: File) => {
    const contentType = file.type || 'application/octet-stream';
    const metaRes = await fetch('/api/tenant/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        mimeType: contentType,
        sizeBytes: file.size,
        // Pre-link to the parent record so the panel filter picks it up.
        entityType,
        entityId,
      }),
    });
    const meta = await metaRes.json();
    if (!metaRes.ok) throw new Error(meta.error || 'Could not record document');

    const putRes = await fetch(meta.data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

    // #3297 — the row above was recorded with `sizeBytes: file.size`, which is what
    // this browser declared before a single byte moved. The PUT lands on the store
    // directly, so only the store can say what the document actually weighs, and
    // `max_storage_gb` is summed from that column. A settle that cannot measure
    // (502) is not a failed upload — the file is exactly where the user put it.
    const settled = await verifyUploadedDocument(meta.data.document.id);
    if (settled.status === 413 || settled.status === 410) {
      throw new Error(settled.error || 'The stored document could not be kept');
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const toastId = toast.loading(`Uploading ${files.length} file(s)…`);

    try {
      const limit = pLimit(5);
      const results = await Promise.allSettled(
        Array.from(files).map((file) => limit(() => uploadFile(file)))
      );

      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length === 0) {
        toast.success(`Uploaded ${files.length} file(s)`, { id: toastId });
      } else if (failures.length === files.length) {
        toast.error(`Failed to upload ${files.length} file(s)`, { id: toastId });
      } else {
        toast.success(`Uploaded ${files.length - failures.length} file(s) (${failures.length} failed)`, { id: toastId });
      }

      load();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadDocument = async (doc: DocumentRow) => {
    try {
      const res = await fetch(`/api/tenant/documents/${doc.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not get download URL');
      window.open(json.data.download_url, '_blank');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const deleteDocument = async (doc: DocumentRow) => {
    await confirmThen(`Delete "${doc.name}"? This cannot be undone.`, async () => {
      try {
        const res = await fetch(`/api/tenant/documents/${doc.id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Delete failed');
        toast.success('Deleted');
        load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Delete failed');
      }
    });
  };

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            dragOver ? 'border-violet-500 bg-violet-500/5' : 'border-border'
          }`}
        >
          <Upload className="w-6 h-6 mx-auto text-foreground/40 mb-1.5" />
          <p className="text-sm text-foreground/70">
            Drop files here or{' '}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="font-medium text-violet-600 hover:underline"
            >
              browse
            </button>
            {uploading && (
              <span className="inline-flex items-center gap-1 text-foreground/50 ml-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
              </span>
            )}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-foreground/40">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-6 text-sm text-foreground/50">
          No documents attached yet.
        </div>
      ) : (
        <div className="border border-border rounded-xl divide-y divide-border">
          {docs.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between px-4 py-3 hover:bg-foreground/[0.02]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-4 h-4 text-foreground/50 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.name}</div>
                  <div className="text-xs text-foreground/50">
                    {formatBytes(d.sizeBytes)} · {d.mimeType} ·{' '}
                    {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => downloadDocument(d)}
                  className="p-2 rounded-lg hover:bg-foreground/10"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                {!readOnly && (
                  <button
                    onClick={() => deleteDocument(d)}
                    className="p-2 rounded-lg hover:bg-foreground/10 text-rose-600"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
