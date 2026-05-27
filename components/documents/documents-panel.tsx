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
import toast from 'react-hot-toast';

export type DocumentEntityType = 'contact' | 'deal' | 'company' | 'lead' | 'ticket';

interface DocumentRow {
  id: string;
  name: string;
  size_bytes: number;
  mime_type: string;
  uploaded_by_name: string | null;
  created_at: string;
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        linked_entity_type: entityType,
        linked_entity_id: entityId,
      });
      const res = await fetch(`/api/tenant/documents?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load documents');
      setDocs(json.data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadFile = async (file: File) => {
    setUploading(true);
    const id = toast.loading(`Uploading ${file.name}…`);
    try {
      const signRes = await fetch('/api/tenant/documents/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
        }),
      });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign.error || 'Could not start upload');

      const putRes = await fetch(sign.upload_url, {
        method: 'PUT',
        headers: sign.required_headers ?? {},
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      const metaRes = await fetch('/api/tenant/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          storage_key: sign.storage_key,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
          // Pre-link to the parent record so the panel filter picks it up.
          linked_entity_type: entityType,
          linked_entity_id: entityId,
        }),
      });
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.error || 'Could not record document');

      toast.success(`Uploaded ${file.name}`, { id });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed', { id });
    } finally {
      setUploading(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      // Sequential to keep toast UX clean; matches the standalone page.
      await uploadFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/tenant/documents/${doc.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
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
                    {formatBytes(d.size_bytes)} · {d.uploaded_by_name ?? '—'} ·{' '}
                    {new Date(d.created_at).toLocaleDateString()}
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
