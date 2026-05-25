'use client';

/**
 * Workspace documents page.
 *
 * Lists all documents the tenant has uploaded with search, filters,
 * and a drag-and-drop upload zone. Uploads use the two-step flow:
 *   1. POST /api/tenant/documents/upload-url -> presigned PUT URL
 *   2. PUT bytes directly to S3 from the browser
 *   3. POST /api/tenant/documents to record metadata
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileText,
  Loader2,
  Search,
  Trash2,
  Upload,
  Download,
  X,
  Tag,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Document {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  description: string | null;
  tags: string[] | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

const inp =
  'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = q ? `/api/tenant/documents?q=${encodeURIComponent(q)}` : '/api/tenant/documents';
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setDocs(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    load(debouncedQuery);
  }, [debouncedQuery, load]);

  const uploadFile = async (file: File) => {
    setUploading(true);
    const id = toast.loading(`Uploading ${file.name}…`);
    try {
      // Step 1: ask the server for a signed upload URL
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

      // Step 2: PUT the bytes to S3 directly
      const putRes = await fetch(sign.upload_url, {
        method: 'PUT',
        headers: sign.required_headers ?? {},
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      // Step 3: record metadata
      const metaRes = await fetch('/api/tenant/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          storage_key: sign.storage_key,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
        }),
      });
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.error || 'Could not record document');

      toast.success(`Uploaded ${file.name}`, { id });
      load(debouncedQuery);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed', { id });
    } finally {
      setUploading(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      // Sequential upload keeps the toast UX clean and avoids hammering S3.
      await uploadFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadDocument = async (doc: Document) => {
    try {
      const res = await fetch(`/api/tenant/documents/${doc.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not get download URL');
      window.open(json.data.download_url, '_blank');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const deleteDocument = async (doc: Document) => {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/tenant/documents/${doc.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      toast.success('Deleted');
      load(debouncedQuery);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileText className="w-6 h-6 text-violet-500" />
            Documents
          </h1>
          <p className="text-sm text-foreground/60 mt-1">
            Upload and share files across your team. {total > 0 && `${total} total.`}
          </p>
        </div>
      </div>

      {/* upload zone */}
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
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? 'border-violet-500 bg-violet-500/5' : 'border-border'
        }`}
      >
        <Upload className="w-8 h-8 mx-auto text-foreground/40 mb-2" />
        <p className="text-sm text-foreground/70">
          Drag files here or{' '}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="font-medium text-violet-600 hover:underline"
          >
            browse
          </button>
          .{' '}
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

      {/* search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
        <input
          className={`${inp} pl-9 pr-9`}
          placeholder="Search by name or description"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-foreground/10"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-foreground/40">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <FileText className="w-10 h-10 text-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-foreground/60">
            {debouncedQuery
              ? 'No documents match that search.'
              : 'No documents yet. Upload your first file above.'}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-foreground/[0.03] text-foreground/60">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Name</th>
                <th className="text-left font-medium px-4 py-2.5">Size</th>
                <th className="text-left font-medium px-4 py-2.5">Uploaded by</th>
                <th className="text-left font-medium px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-border hover:bg-foreground/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-foreground/50 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{d.name}</div>
                        {d.description && (
                          <div className="text-xs text-foreground/50 truncate">
                            {d.description}
                          </div>
                        )}
                        {d.tags && d.tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <Tag className="w-3 h-3 text-foreground/40" />
                            {d.tags.map((t) => (
                              <span
                                key={t}
                                className="text-xs px-1.5 py-0.5 rounded bg-foreground/10"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground/70">{formatBytes(d.size_bytes)}</td>
                  <td className="px-4 py-3 text-foreground/70">{d.uploaded_by_name ?? '—'}</td>
                  <td className="px-4 py-3 text-foreground/70">
                    {new Date(d.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => downloadDocument(d)}
                      className="p-2 rounded-lg hover:bg-foreground/10"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteDocument(d)}
                      className="p-2 rounded-lg hover:bg-foreground/10 text-rose-600"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
