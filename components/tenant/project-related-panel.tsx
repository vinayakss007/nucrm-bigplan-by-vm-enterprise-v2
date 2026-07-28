'use client';

/**
 * Related-records panel for a project — surfaces the leads, contacts, companies
 * and deals linked to a project so "everything for this project in one place"
 * is actually visible (docs/workflow-gaps.md WF-05). Self-contained: fetches
 * from /api/tenant/projects/:id/related and manages its own state so it can be
 * dropped into the project detail page with a single line.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Link2, Plus, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface RelatedRecord {
  linkId: string;
  relation: string;
  entityType: string;
  entityId: string;
  label: string;
}

const LINKABLE = [
  { type: 'lead', label: 'Lead', href: (id: string) => `/tenant/leads/${id}` },
  { type: 'contact', label: 'Contact', href: (id: string) => `/tenant/contacts/${id}` },
  { type: 'company', label: 'Company', href: (id: string) => `/tenant/companies/${id}` },
  { type: 'deal', label: 'Deal', href: (id: string) => `/tenant/deals/${id}` },
] as const;

function hrefFor(type: string, id: string): string | null {
  return LINKABLE.find((l) => l.type === type)?.href(id) ?? null;
}

export default function ProjectRelatedPanel({ projectId }: { projectId: string }) {
  const [records, setRecords] = useState<RelatedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [entityType, setEntityType] = useState('lead');
  const [entityId, setEntityId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/projects/${projectId}/related`, { signal });
      const data = await res.json();
      if (!signal?.aborted) setRecords(data.data ?? []);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') toast.error('Failed to load related records');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal);
    return () => abort.abort();
  }, [load]);

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    if (!entityId.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tenant/projects/${projectId}/related`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId: entityId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to link');
      toast.success('Linked');
      setEntityId('');
      setAdding(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to link');
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(linkId: string) {
    const res = await fetch(`/api/tenant/projects/${projectId}/related?linkId=${encodeURIComponent(linkId)}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Failed to unlink'); return; }
    setRecords((prev) => prev.filter((r) => r.linkId !== linkId));
  }

  const grouped = LINKABLE.map((l) => ({
    ...l,
    items: records.filter((r) => r.entityType === l.type),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="admin-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold inline-flex items-center gap-2">
          <Link2 className="w-4 h-4" /> Related records
        </h3>
        <button onClick={() => setAdding((v) => !v)} className="text-sm inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border">
          <Plus className="w-3.5 h-3.5" /> Link
        </button>
      </div>

      {adding && (
        <form onSubmit={addLink} className="flex flex-wrap gap-2 mb-3">
          <select aria-label="Record type" value={entityType} onChange={(e) => setEntityType(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-card text-sm">
            {LINKABLE.map((l) => <option key={l.type} value={l.type}>{l.label}</option>)}
          </select>
          <input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="Record ID (UUID)" className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          <button type="submit" disabled={busy} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm inline-flex items-center gap-1">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Link
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">No leads, contacts, companies or deals linked yet.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.type}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{g.label}s</div>
              <ul className="space-y-1">
                {g.items.map((r) => {
                  const href = hrefFor(r.entityType, r.entityId);
                  return (
                    <li key={r.linkId} className="flex items-center justify-between text-sm py-1">
                      {href ? (
                        <Link href={href} className="text-primary hover:underline truncate">{r.label}</Link>
                      ) : (
                        <span className="truncate">{r.label}</span>
                      )}
                      <button onClick={() => removeLink(r.linkId)} aria-label={`Unlink ${r.label}`} className="p-1 rounded hover:bg-destructive/10 text-destructive shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
