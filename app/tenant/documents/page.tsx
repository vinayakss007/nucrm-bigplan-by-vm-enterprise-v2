'use client';

import { useState, useEffect, useCallback } from 'react';

interface DocumentFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  folderId: string | null;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: 'Root' },
  ]);
  const [uploading, setUploading] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadDocuments = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (currentFolder) params.set('folderId', currentFolder);
      const res = await fetch(`/api/tenant/documents?${params}`);
      if (res.ok) {
        const { data } = await res.json();
        setDocuments(data.documents ?? []);
        setFolders(data.folders ?? []);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }, [currentFolder]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  function navigateToFolder(folder: Folder) {
    setCurrentFolder(folder.id);
    setBreadcrumb(prev => [...prev, { id: folder.id, name: folder.name }]);
    setLoading(true);
  }

  function navigateToBreadcrumb(index: number) {
    const item = breadcrumb[index];
    if (!item) return;
    setCurrentFolder(item.id);
    setBreadcrumb(prev => prev.slice(0, index + 1));
    setLoading(true);
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const res = await fetch('/api/tenant/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            folderId: currentFolder,
          }),
        });

        if (res.ok) {
          const { data } = await res.json();
          // Upload file to presigned URL
          if (data.uploadUrl) {
            await fetch(data.uploadUrl, {
              method: 'PUT',
              body: file,
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
            });
          }
        }
      }
      setMessage({ type: 'success', text: `${files.length} file(s) uploaded successfully` });
      await loadDocuments();
    } catch {
      setMessage({ type: 'error', text: 'Failed to upload files' });
    } finally {
      setUploading(false);
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch('/api/tenant/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim(), folderId: currentFolder, createFolder: true }),
      });
      if (res.ok) {
        setNewFolderName('');
        setShowNewFolder(false);
        await loadDocuments();
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to create folder' });
    }
  }

  async function deleteDocument(id: string) {
    try {
      const res = await fetch(`/api/tenant/documents?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== id));
        setMessage({ type: 'success', text: 'Document deleted' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete document' });
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(mimeType: string): string {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('document') || mimeType.includes('word')) return '📄';
    return '📎';
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-7 w-48 bg-muted rounded-xl" />
        <div className="h-40 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Documents</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewFolder(!showNewFolder)}
            className="px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80"
          >
            New Folder
          </button>
          <label className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 cursor-pointer">
            Upload Files
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="flex gap-1 text-sm text-muted-foreground">
        {breadcrumb.map((item, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <button
              onClick={() => navigateToBreadcrumb(i)}
              className="hover:text-foreground hover:underline"
            >
              {item.name}
            </button>
          </span>
        ))}
      </nav>

      {/* New folder form */}
      {showNewFolder && (
        <div className="flex gap-2 items-center p-3 bg-muted/50 rounded-lg">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="flex-1 px-3 py-1.5 border rounded-lg text-sm"
            onKeyDown={(e) => e.key === 'Enter' && createFolder()}
          />
          <button onClick={createFolder} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg">
            Create
          </button>
          <button onClick={() => setShowNewFolder(false)} className="px-3 py-1.5 text-sm text-muted-foreground">
            Cancel
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleUpload(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        <p className="text-muted-foreground text-sm">
          {uploading ? 'Uploading...' : 'Drag and drop files here, or use the Upload button'}
        </p>
      </div>

      {/* Folders */}
      {folders.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {folders.map(folder => (
            <button
              key={folder.id}
              onClick={() => navigateToFolder(folder)}
              className="flex flex-col items-center gap-1 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <span className="text-3xl">📁</span>
              <span className="text-xs font-medium truncate w-full text-center">{folder.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Files */}
      {documents.length > 0 ? (
        <div className="admin-card overflow-hidden">
          <div className="divide-y divide-border">
            {documents.map(doc => (
              <div key={doc.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30">
                <span className="text-xl">{getFileIcon(doc.mimeType)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(doc.sizeBytes)} &middot; {new Date(doc.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => deleteDocument(doc.id)}
                  className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        folders.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg">No documents yet</p>
            <p className="text-sm mt-1">Upload files or create folders to get started</p>
          </div>
        )
      )}
    </div>
  );
}
