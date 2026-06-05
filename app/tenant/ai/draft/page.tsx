'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  FileEdit, Send, Wand2, AlertCircle, Loader2, Check, ChevronDown, Settings as SettingsIcon,
  Copy, RefreshCw, Sparkles, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type Template = {
  id: string | null;
  slug: string;
  name: string;
  description: string | null;
  kind: 'email' | 'note' | 'reply' | 'call_prep';
  defaultSubject?: string | null;
  default_subject?: string | null;
  seed?: boolean;
};

type EntityHit = {
  id: string;
  label: string;
  sublabel?: string;
  entity_type: 'contact' | 'deal' | 'company';
};

type DraftResp = {
  kind: string;
  subject: string | null;
  body: string;
  provider: string;
  model: string;
  tokens_used: number;
  latency_ms: number;
  fallbacks_used: number;
  activity_id: string | null;
  template: string;
};

const ENTITY_TYPES: { id: EntityHit['entity_type']; label: string; api: string }[] = [
  { id: 'contact', label: 'Contact',  api: '/api/tenant/contacts?limit=8&search=' },
  { id: 'deal',    label: 'Deal',     api: '/api/tenant/deals?limit=8&search=' },
  { id: 'company', label: 'Company',  api: '/api/tenant/companies?limit=8&search=' },
];

export default function AIDraftPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [entityType, setEntityType] = useState<EntityHit['entity_type']>('contact');
  const [entitySearch, setEntitySearch] = useState('');
  const [entityHits, setEntityHits] = useState<EntityHit[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<EntityHit | null>(null);
  const [customInstructions, setCustomInstructions] = useState('');
  const [busy, setBusy] = useState<'generate' | null>(null);
  const [draft, setDraft] = useState<DraftResp | null>(null);
  const [editedSubject, setEditedSubject] = useState('');
  const [editedBody, setEditedBody] = useState('');
  const [copied, setCopied] = useState(false);

  // Load templates (db rows + seeds, the API merges them)
  useEffect(() => {
    fetch('/api/tenant/admin/ai-templates')
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { templates: Template[]; seeds: Template[] }) => {
        // For non-admins this fails (admin-only endpoint). Fall back to seeds-only via the public draft API.
        const all = [...(d.templates ?? []), ...(d.seeds ?? [])];
        setTemplates(all);
        if (all[0]) setSelectedTemplate(all[0]);
      })
      .catch(() => {
        // Fallback: empty templates list — the API still has a generic prompt
        setTemplates([]);
      });
  }, []);

  // Search entities as the user types
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const cfg = ENTITY_TYPES.find(e => e.id === entityType)!;
        const r = await fetch(cfg.api + encodeURIComponent(entitySearch), { cache: 'no-store' });
        if (!r.ok) { setEntityHits([]); return; }
        const data = await r.json();
        const list = data.contacts ?? data.deals ?? data.companies ?? data.data ?? [];
        type Row = { id: string; firstName?: string; lastName?: string; email?: string; title?: string; name?: string; companyName?: string };
        const hits: EntityHit[] = list.slice(0, 8).map((row: Row) => {
          if (entityType === 'contact') {
            return {
              id: row.id,
              entity_type: 'contact',
              label: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || (row.email ?? '—'),
              sublabel: row.email ?? row.companyName ?? undefined,
            };
          }
          if (entityType === 'deal') {
            return { id: row.id, entity_type: 'deal', label: row.title ?? '—' };
          }
          return { id: row.id, entity_type: 'company', label: row.name ?? '—' };
        });
        setEntityHits(hits);
      } catch {
        setEntityHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [entityType, entitySearch]);

  async function generate() {
    if (!selectedEntity) {
      setError('Pick a contact, deal or company first');
      return;
    }
    setBusy('generate');
    setError(null);
    try {
      const body = {
        ...(selectedTemplate?.id ? { template_id: selectedTemplate.id } : {}),
        ...(selectedTemplate?.seed ? { template_slug: selectedTemplate.slug } : {}),
        entity_type: selectedEntity.entity_type,
        entity_id: selectedEntity.id,
        custom_instructions: customInstructions || undefined,
      };
      const r = await fetch('/api/tenant/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: DraftResp & { error?: string } = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setDraft(data);
      setEditedSubject(data.subject ?? '');
      setEditedBody(data.body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    const text = draft?.kind === 'email' && editedSubject
      ? `Subject: ${editedSubject}\n\n${editedBody}`
      : editedBody;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  async function rate(accepted: boolean) {
    if (!draft?.activity_id) return;
    fetch('/api/tenant/ai/activity', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draft.activity_id, accepted }),
    }).catch(() => {});
  }

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <FileEdit className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Auto-Draft</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Pick an entity, pick a template, click <strong>Generate</strong>. Edit, then send. The AI fills in the gaps using <code>{`{{contact.first_name}}`}</code>-style tokens from your prompts.
          </p>
        </div>
        <Link
          href="/tenant/settings/ai-templates"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm"
        >
          <SettingsIcon className="w-3.5 h-3.5" />Manage templates
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: picker */}
        <div className="space-y-3">
          <Card title="1. Template">
            {templates === null && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {templates !== null && templates.length === 0 && (
              <p className="text-sm text-muted-foreground">No templates configured. <Link href="/tenant/settings/ai-templates" className="text-violet-600 hover:underline">Add one</Link>.</p>
            )}
            <div className="space-y-1.5">
              {templates?.map(t => {
                const active = selectedTemplate
                  && (selectedTemplate.id ? selectedTemplate.id === t.id : selectedTemplate.slug === t.slug);
                return (
                  <button
                    key={t.id ?? t.slug}
                    onClick={() => setSelectedTemplate(t)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-lg border transition-colors',
                      active
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                        {t.kind}
                      </span>
                      {t.seed && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">starter</span>}
                    </div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    {t.description && <p className="text-xs text-muted-foreground line-clamp-1">{t.description}</p>}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="2. About">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {ENTITY_TYPES.map(et => (
                <button
                  key={et.id}
                  onClick={() => { setEntityType(et.id); setSelectedEntity(null); setEntitySearch(''); }}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    entityType === et.id ? 'bg-violet-600 text-white' : 'bg-muted hover:bg-accent'
                  )}
                >{et.label}</button>
              ))}
            </div>
            <input
              type="search"
              value={entitySearch}
              onChange={e => setEntitySearch(e.target.value)}
              placeholder={`Search ${entityType}s…`}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500 text-sm"
            />
            {entityHits.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border">
                {entityHits.map(h => (
                  <button
                    key={h.id}
                    onClick={() => setSelectedEntity(h)}
                    className={cn(
                      'w-full text-left px-3 py-2 border-b border-border/50 last:border-0 hover:bg-accent transition-colors',
                      selectedEntity?.id === h.id && 'bg-violet-50 dark:bg-violet-950/30'
                    )}
                  >
                    <p className="text-sm font-medium truncate">{h.label}</p>
                    {h.sublabel && <p className="text-xs text-muted-foreground truncate">{h.sublabel}</p>}
                  </button>
                ))}
              </div>
            )}
            {selectedEntity && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-950/30 text-sm">
                <Check className="w-4 h-4 text-violet-600" />
                <span className="flex-1 truncate font-medium">{selectedEntity.label}</span>
                <button onClick={() => setSelectedEntity(null)} className="text-xs text-muted-foreground hover:text-foreground">Change</button>
              </div>
            )}
          </Card>

          <Card title="3. Optional instructions">
            <textarea
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              rows={3}
              placeholder="e.g. Reference our pilot last quarter. Keep it under 80 words."
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500 text-sm"
            />
          </Card>

          <button
            onClick={generate}
            disabled={busy !== null || !selectedEntity}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold"
          >
            {busy === 'generate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {draft ? 'Regenerate' : 'Generate draft'}
          </button>
        </div>

        {/* Right: draft */}
        <div className="space-y-3">
          <Card title="Draft" extra={
            draft && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                <span>{draft.provider}</span>
                <span>·</span>
                <span>{draft.tokens_used} tokens</span>
                <span>·</span>
                <span>{draft.latency_ms}ms</span>
                {draft.fallbacks_used > 0 && <><span>·</span><span className="text-amber-600">fallback</span></>}
              </div>
            )
          }>
            {!draft && (
              <div className="text-center py-12 text-muted-foreground">
                <Sparkles className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm">No draft yet. Pick an entity and click Generate.</p>
              </div>
            )}
            {draft && (
              <div className="space-y-3">
                {draft.kind === 'email' && (
                  <Field label="Subject">
                    <input value={editedSubject} onChange={e => setEditedSubject(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500" />
                  </Field>
                )}
                <Field label="Body">
                  <textarea
                    value={editedBody}
                    onChange={e => setEditedBody(e.target.value)}
                    rows={14}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500 text-sm font-mono"
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={copy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm"
                  >
                    {copied ? <><Check className="w-3.5 h-3.5 text-emerald-600" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
                  </button>
                  <div className="flex-1" />
                  <span className="text-xs text-muted-foreground">Was this useful?</span>
                  <button
                    onClick={() => rate(true)}
                    className="px-2 py-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  >👍</button>
                  <button
                    onClick={() => rate(false)}
                    className="px-2 py-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >👎</button>
                </div>
              </div>
            )}
          </Card>

          {draft && (
            <Link href="/tenant/ai/activity" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              See in AI activity log <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
        {extra}
      </div>
      {children}
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
