'use client';
import { useState, useEffect } from 'react';
import {
  MessageSquare, Sparkles, AlertCircle, Loader2, Check, Copy, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { logError } from '@/lib/errors';

type EntityHit = {
  id: string;
  label: string;
  sublabel?: string;
  entity_type: 'contact' | 'deal' | 'company';
};

type SummarizeResp = {
  summary: string;
  provider: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  fallbacksUsed: number;
  activityId: string | null;
};

const ENTITY_TYPES: { id: EntityHit['entity_type']; label: string; api: string }[] = [
  { id: 'contact', label: 'Contact',  api: '/api/tenant/contacts?limit=8&search=' },
  { id: 'deal',    label: 'Deal',     api: '/api/tenant/deals?limit=8&search=' },
  { id: 'company', label: 'Company',  api: '/api/tenant/companies?limit=8&search=' },
];

export default function AISummarizePage() {
  const [entityType, setEntityType] = useState<EntityHit['entity_type']>('contact');
  const [entitySearch, setEntitySearch] = useState('');
  const [entityHits, setEntityHits] = useState<EntityHit[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<EntityHit | null>(null);
  const [customInstructions, setCustomInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummarizeResp | null>(null);
  const [copied, setCopied] = useState(false);

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
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/tenant/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_type: selectedEntity.entity_type,
          entity_id: selectedEntity.id,
          custom_instructions: customInstructions || undefined,
        }),
      });
      const data: SummarizeResp & { error?: string } = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) { logError({ error: err, context: 'summarize-copy' }); }
  }

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <MessageSquare className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Summarize</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Pick any contact, deal or company and get a TL;DR — what it is, current status, key details, and what to do next.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Card title="1. Pick a record">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {ENTITY_TYPES.map(et => (
                <button
                  key={et.id}
                  onClick={() => { setEntityType(et.id); setSelectedEntity(null); setEntitySearch(''); setResult(null); }}
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

          <Card title="2. Optional focus">
            <textarea
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              rows={3}
              placeholder="e.g. Focus on recent activity and next steps."
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500 text-sm"
            />
          </Card>

          <button
            onClick={generate}
            disabled={busy || !selectedEntity}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {result ? 'Regenerate' : 'Generate summary'}
          </button>
        </div>

        <div className="space-y-3">
          <Card title="TL;DR" extra={
            result && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                <span>{result.provider}</span>
                <span>·</span>
                <span>{result.tokensUsed} tokens</span>
                <span>·</span>
                <span>{result.latencyMs}ms</span>
                {result.fallbacksUsed > 0 && <><span>·</span><span className="text-amber-600">fallback</span></>}
              </div>
            )
          }>
            {!result && !busy && (
              <div className="text-center py-12 text-muted-foreground">
                <Sparkles className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm">Pick a record and click Generate to see a summary.</p>
              </div>
            )}
            {busy && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Generating summary…</span>
              </div>
            )}
            {result && (
              <div className="space-y-3">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {result.summary.split('\n').map((p, i) => (
                    <p key={i} className="text-sm leading-relaxed">{p || '\u00A0'}</p>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                  <button
                    onClick={copy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm"
                  >
                    {copied ? <><Check className="w-3.5 h-3.5 text-emerald-600" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
                  </button>
                </div>
              </div>
            )}
          </Card>

          {result && (
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
