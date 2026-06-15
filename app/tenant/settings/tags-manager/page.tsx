'use client';
import { useEffect, useMemo, useState } from 'react';
import { Tag, Search, Pencil, GitMerge, Trash2, RefreshCw, Loader2, ShieldX, X, AlertCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type TagRow = { tag: string; leads: number; contacts: number; companies: number; total: number };

export default function TagsManagerPage() {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<TagRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TagRow | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    const res = await fetch('/api/tenant/admin/tags');
    if (res.ok) {
      const d = await res.json();
      setTags(d.tags ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetch('/api/tenant/me').then(r => r.json()).then(d => setIsAdmin(d?.is_admin ?? false));
    reload();
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() =>
    q ? tags.filter(t => t.tag.toLowerCase().includes(q)) : tags
  , [tags, q]);

  const toggle = (tag: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(tag)) next.delete(tag); else next.add(tag);
    return next;
  });

  const doRename = async () => {
    if (!renameTarget) return;
    const value = renameValue.trim();
    if (!value || value === renameTarget.tag) return;
    setBusy(true);
    const res = await fetch('/api/tenant/admin/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', tag: renameTarget.tag, new_tag: value }),
    });
    const d = await res.json();
    setBusy(false);
    if (res.ok) {
      toast.success(`Renamed across ${d.total} record(s)`);
      setRenameTarget(null); setRenameValue('');
      reload();
    } else {
      toast.error(d.error ?? 'Failed');
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const res = await fetch('/api/tenant/admin/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', tag: deleteTarget.tag }),
    });
    const d = await res.json();
    setBusy(false);
    if (res.ok) {
      toast.success(`Removed from ${d.total} record(s)`);
      setDeleteTarget(null);
      reload();
    } else {
      toast.error(d.error ?? 'Failed');
    }
  };

  const doMerge = async () => {
    if (selected.size < 2 || !mergeTarget.trim()) return;
    setBusy(true);
    const res = await fetch('/api/tenant/admin/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'merge', tags: Array.from(selected), new_tag: mergeTarget.trim() }),
    });
    const d = await res.json();
    setBusy(false);
    if (res.ok) {
      toast.success(`Merged ${selected.size} tag(s) → "${mergeTarget.trim()}" across ${d.total} record(s)`);
      setSelected(new Set()); setMergeTarget(''); setMergeOpen(false);
      reload();
    } else {
      toast.error(d.error ?? 'Failed');
    }
  };

  if (!isAdmin) return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-5 flex items-start gap-3">
      <ShieldX className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold text-amber-700 dark:text-amber-300">Admins only</p>
        <p className="text-sm text-amber-700/70 dark:text-amber-300/70">Tags Manager is editable by admins.</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Tag className="w-5 h-5 text-violet-600" />Tags Manager</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rename, merge or delete tags across leads, contacts and companies in one operation. Deals' metadata-tags aren't affected.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Filter tags…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-accent transition-colors disabled:opacity-50">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
          {selected.size >= 2 && (
            <button onClick={() => setMergeOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors">
              <GitMerge className="w-3.5 h-3.5" />
              Merge {selected.size} tags
            </button>
          )}
        </div>
      </div>

      {/* Selected banner */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 bg-violet-50 dark:bg-violet-950/30 border border-violet-300 dark:border-violet-800 rounded-lg text-xs">
          <p className="text-violet-700 dark:text-violet-300 font-medium truncate">
            {selected.size} selected: <span className="font-mono">{Array.from(selected).slice(0, 4).join(', ')}{selected.size > 4 && '…'}</span>
          </p>
          <button onClick={() => setSelected(new Set())} className="text-violet-700 dark:text-violet-300 hover:underline shrink-0">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {/* Mobile view: card list */}
        <div className="sm:hidden divide-y divide-border">
          {loading ? (
            <div className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">{q ? `No tags match "${query}"` : 'No tags yet'}</div>
          ) : (
            filtered.map(row => (
              <div key={row.tag} className="px-3 py-3 flex items-start gap-2">
                <input type="checkbox" checked={selected.has(row.tag)} onChange={() => toggle(row.tag)} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-semibold truncate">{row.tag}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                    {row.total} total — {row.leads}L · {row.contacts}C · {row.companies}Co
                  </p>
                </div>
                <button onClick={() => { setRenameTarget(row); setRenameValue(row.tag); }}
                  className="p-1.5 rounded text-muted-foreground hover:text-violet-600 hover:bg-accent" title="Rename">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setDeleteTarget(row)}
                  className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Desktop view: table */}
        <table className="w-full hidden sm:table">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5 w-8"></th>
              <th className="px-3 py-2.5 text-left">Tag</th>
              <th className="px-3 py-2.5 text-right">Leads</th>
              <th className="px-3 py-2.5 text-right">Contacts</th>
              <th className="px-3 py-2.5 text-right">Companies</th>
              <th className="px-3 py-2.5 text-right">Total</th>
              <th className="px-3 py-2.5 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">{q ? `No tags match "${query}"` : 'No tags yet'}</td></tr>
            )}
            {filtered.map(row => (
              <tr key={row.tag} className={cn('border-b border-border last:border-0 hover:bg-accent/30 transition-colors', selected.has(row.tag) && 'bg-violet-50/50 dark:bg-violet-950/10')}>
                <td className="px-3 py-2"><input type="checkbox" checked={selected.has(row.tag)} onChange={() => toggle(row.tag)} /></td>
                <td className="px-3 py-2"><span className="text-sm font-mono">{row.tag}</span></td>
                <td className="px-3 py-2 text-right text-sm tabular-nums">{row.leads.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-sm tabular-nums">{row.contacts.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-sm tabular-nums">{row.companies.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{row.total.toLocaleString()}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => { setRenameTarget(row); setRenameValue(row.tag); }}
                      title="Rename"
                      className="p-1 rounded text-muted-foreground hover:text-violet-600 hover:bg-accent transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteTarget(row)}
                      title="Delete"
                      className="p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rename modal */}
      {renameTarget && (
        <Modal title="Rename tag" onClose={() => setRenameTarget(null)} icon={Pencil}>
          <p className="text-sm text-muted-foreground">
            Renames <code className="text-violet-600 font-semibold">{renameTarget.tag}</code> across {renameTarget.total} record(s).
          </p>
          <input className={inp} autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doRename()} placeholder="New tag name" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setRenameTarget(null)}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={doRename} disabled={busy || !renameValue.trim() || renameValue.trim() === renameTarget.tag}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Rename
            </button>
          </div>
        </Modal>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <Modal title="Delete tag" onClose={() => setDeleteTarget(null)} icon={AlertCircle} variant="danger">
          <p className="text-sm">
            Remove <code className="text-red-600 font-semibold">{deleteTarget.tag}</code> from {deleteTarget.total} record(s)?
          </p>
          <p className="text-xs text-muted-foreground">
            The records themselves are kept — only the tag is removed. Logged in audit trail.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={doDelete} disabled={busy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Delete tag
            </button>
          </div>
        </Modal>
      )}

      {/* Merge modal */}
      {mergeOpen && (
        <Modal title="Merge tags" onClose={() => setMergeOpen(false)} icon={GitMerge}>
          <p className="text-sm text-muted-foreground">
            Combine the selected tags into a single target. All records carrying any selected tag will end up tagged with the target.
          </p>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {Array.from(selected).map(t => (
              <span key={t} className="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-mono">{t}</span>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Target tag (final)</label>
            <input className={inp} autoFocus value={mergeTarget} onChange={e => setMergeTarget(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doMerge()}
              placeholder="e.g. high-value (existing or new)" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setMergeOpen(false)}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={doMerge} disabled={busy || !mergeTarget.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
              Merge into "{mergeTarget.trim() || '…'}"
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

function Modal({ title, onClose, icon: Icon, variant, children }: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  title: string; onClose: () => void; icon: any; variant?: 'danger'; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className={cn('w-5 h-5', variant === 'danger' ? 'text-red-600' : 'text-violet-600')} />
            <h3 className="font-semibold">{title}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
