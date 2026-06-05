'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  FileEdit, Plus, Save, X, Sparkles, AlertCircle, Loader2, Trash2, Eye, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Template = {
  id: string | null;
  slug: string;
  name: string;
  description: string | null;
  kind: 'email' | 'note' | 'reply' | 'call_prep';
  entityTypes?: string;
  entity_types?: string;
  systemPrompt?: string;
  system_prompt?: string;
  userPrompt?: string;
  user_prompt?: string;
  tone: string | null;
  defaultSubject?: string | null;
  default_subject?: string | null;
  active: boolean;
  seed?: boolean;
};

type Resp = { templates: Template[]; seeds: Template[] };

const KINDS: { id: Template['kind']; label: string }[] = [
  { id: 'email',     label: 'Email' },
  { id: 'reply',     label: 'Reply' },
  { id: 'note',      label: 'Note' },
  { id: 'call_prep', label: 'Call prep' },
];
const TONES = ['professional', 'warm', 'casual', 'concise', 'bold'];

function readSystem(t: Template): string {
  return (t.systemPrompt ?? t.system_prompt ?? '') as string;
}
function readUser(t: Template): string {
  return (t.userPrompt ?? t.user_prompt ?? '') as string;
}
function readEntityTypes(t: Template): string {
  return (t.entityTypes ?? t.entity_types ?? 'contact,deal') as string;
}
function readSubject(t: Template): string {
  return (t.defaultSubject ?? t.default_subject ?? '') as string;
}

const EMPTY_TEMPLATE: Template = {
  id: null,
  slug: '',
  name: '',
  description: '',
  kind: 'email',
  entityTypes: 'contact,deal',
  systemPrompt: '',
  userPrompt: '',
  tone: 'professional',
  defaultSubject: '',
  active: true,
};

export default function AITemplatesPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetch('/api/tenant/admin/ai-templates', { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function installSeed(slug: string) {
    setBusy('install:' + slug);
    setError(null);
    try {
      const r = await fetch('/api/tenant/admin/ai-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function save(t: Template) {
    setBusy('save');
    setError(null);
    try {
      const url = t.id
        ? `/api/tenant/admin/ai-templates/${t.id}`
        : '/api/tenant/admin/ai-templates';
      const method = t.id ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: t.name,
          slug: t.slug || undefined,
          description: t.description ?? '',
          kind: t.kind,
          entity_types: readEntityTypes(t),
          system_prompt: readSystem(t),
          user_prompt: readUser(t),
          tone: t.tone ?? 'professional',
          default_subject: readSubject(t),
          active: t.active,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setEditing(null);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function remove(t: Template) {
    if (!t.id) return;
    if (!confirm(`Delete "${t.name}"? This soft-deletes the template (draft history is preserved).`)) return;
    setBusy('delete:' + t.id);
    setError(null);
    try {
      const r = await fetch(`/api/tenant/admin/ai-templates/${t.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  const installed = data?.templates ?? [];
  const seeds     = data?.seeds ?? [];

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <FileEdit className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Auto-Draft templates</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Prompts for the AI Auto-Draft surface. The picker on <code>/tenant/ai/draft</code> lets reps choose a template, an entity, and the AI fills in the gaps using <code>{`{{contact.first_name}}`}</code> style tokens you put in the prompts.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />Refresh
        </button>
        <button
          onClick={() => setEditing({ ...EMPTY_TEMPLATE })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
        >
          <Plus className="w-3.5 h-3.5" />New template
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Installed */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Your templates ({installed.length})</h2>
        {loading && !data && (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </div>
        )}
        {!loading && installed.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No saved templates yet. Install one of the starters below or click <strong>New template</strong>.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {installed.map(t => (
            <Card key={t.id ?? t.slug} t={t}
              busy={busy}
              onEdit={() => setEditing({ ...t })}
              onDelete={() => remove(t)}
            />
          ))}
        </div>
      </div>

      {/* Seeds */}
      {seeds.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />Starter library — install with one click
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {seeds.map(s => (
              <SeedCard key={s.slug} t={s} busy={busy} onInstall={() => installSeed(s.slug)} />
            ))}
          </div>
        </div>
      )}

      {editing && (
        <Editor
          template={editing}
          busy={busy === 'save'}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function Card({ t, busy, onEdit, onDelete }: { t: Template; busy: string | null; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className={cn(
      'rounded-xl border bg-card p-4 flex flex-col gap-2',
      t.active ? 'border-border' : 'border-border/50 opacity-60'
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              {t.kind}
            </span>
            {!t.active && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">disabled</span>}
            <code className="text-[10px] font-mono text-muted-foreground/60 truncate">{t.slug}</code>
          </div>
          <p className="text-sm font-bold mt-1 truncate">{t.name}</p>
          {t.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{t.description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border hover:bg-accent"
        >
          <Eye className="w-3 h-3" />Edit
        </button>
        {t.id && (
          <button
            onClick={onDelete}
            disabled={busy === 'delete:' + t.id}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-red-300 dark:border-red-800/50 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" />Delete
          </button>
        )}
      </div>
    </div>
  );
}

function SeedCard({ t, busy, onInstall }: { t: Template; busy: string | null; onInstall: () => void }) {
  const isInstalling = busy === 'install:' + t.slug;
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-4 flex flex-col gap-2">
      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {t.kind}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">starter</span>
        </div>
        <p className="text-sm font-bold mt-1">{t.name}</p>
        {t.description && <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>}
      </div>
      <button
        onClick={onInstall}
        disabled={isInstalling}
        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 mt-1"
      >
        {isInstalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        Install
      </button>
    </div>
  );
}

function Editor({ template, busy, onClose, onSave }: { template: Template; busy: boolean; onClose: () => void; onSave: (t: Template) => void }) {
  const [draft, setDraft] = useState<Template>({
    ...template,
    systemPrompt: readSystem(template),
    userPrompt: readUser(template),
    entityTypes: readEntityTypes(template),
    defaultSubject: readSubject(template),
  });
  const isNew = !draft.id;

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-stretch sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-card sm:rounded-2xl border border-border shadow-xl w-full max-w-2xl flex flex-col h-full sm:h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-lg font-bold">{isNew ? 'New template' : `Edit ${draft.name}`}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name">
              <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </Field>
            <Field label="Slug (optional)">
              <input value={draft.slug} onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))}
                placeholder="auto-generated"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border font-mono text-xs focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </Field>
          </div>
          <Field label="Description">
            <input value={draft.description ?? ''} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Kind">
              <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as Template['kind'] }))}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500">
                {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Tone">
              <select value={draft.tone ?? 'professional'} onChange={e => setDraft(d => ({ ...d, tone: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500">
                {TONES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Entity types (comma-separated)">
              <input value={readEntityTypes(draft)} onChange={e => setDraft(d => ({ ...d, entityTypes: e.target.value }))}
                placeholder="contact,deal"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono text-xs" />
            </Field>
          </div>
          {draft.kind === 'email' && (
            <Field label="Default subject (optional, supports {{tokens}})">
              <input value={readSubject(draft)} onChange={e => setDraft(d => ({ ...d, defaultSubject: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </Field>
          )}
          <Field label="System prompt (sets tone / persona / output format)">
            <textarea value={readSystem(draft)} onChange={e => setDraft(d => ({ ...d, systemPrompt: e.target.value }))}
              rows={5}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border font-mono text-xs focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </Field>
          <Field label="User prompt template (supports {{contact.first_name}}, {{deal.title}}, …)">
            <textarea value={readUser(draft)} onChange={e => setDraft(d => ({ ...d, userPrompt: e.target.value }))}
              rows={6}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border font-mono text-xs focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))} />
            Active (visible in the picker)
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-border hover:bg-accent text-sm">Cancel</button>
          <button
            onClick={() => onSave(draft)}
            disabled={busy || !draft.name.trim() || !readSystem(draft).trim() || !readUser(draft).trim()}
            className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isNew ? 'Create template' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block text-xs font-semibold text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}
