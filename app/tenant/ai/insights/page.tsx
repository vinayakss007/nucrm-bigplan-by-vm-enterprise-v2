/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Lightbulb, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchJsonOrThrow } from '@/lib/fetch-json';
import InlineErrorState from '@/components/shared/inline-error-state';

type EntityType = 'contact' | 'deal';
type Hit = { id: string; label: string; sublabel?: string; entity_type: EntityType };
type Insight = {
  id: string;
  type: string;
  title: string;
  content: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  score: string | number;
  metadata?: { ai?: boolean } | null;
};
type GenerateResp = { ok: boolean; ai: boolean; insights: Insight[] };

const SEARCH_URL: Record<EntityType, string> = {
  contact: '/api/tenant/contacts?limit=8&q=',
  deal: '/api/tenant/deals?limit=8&q=',
};

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};

type SearchRow = { id: string; firstName?: string; lastName?: string; email?: string; title?: string; companyName?: string };
type SearchResp = { data?: SearchRow[] };

export default function AIInsightsPage() {
  const [entityType, setEntityType] = useState<EntityType>('contact');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Hit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const searchQuery = useApiQuery<SearchResp>(
    ['tenant', 'ai', 'insights-search', entityType, debounced],
    SEARCH_URL[entityType] + encodeURIComponent(debounced),
  );

  const hits = useMemo((): Hit[] => {
    const rows = searchQuery.data?.data ?? [];
    return rows.slice(0, 8).map((row) => entityType === 'contact'
      ? {
          id: row.id,
          entity_type: 'contact',
          label: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || row.email || '—',
          sublabel: row.companyName || row.email,
        }
      : { id: row.id, entity_type: 'deal', label: row.title || '—' });
  }, [searchQuery.data, entityType]);

  const generate = useMutation({
    mutationFn: () => fetchJsonOrThrow<GenerateResp>('/api/tenant/ai/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: selected!.entity_type, entity_id: selected!.id }),
    }),
    onMutate: () => { setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const saved = useApiQuery<{ data: Insight[] }>(
    ['tenant', 'ai', 'insights-list', selected?.entity_type ?? '', selected?.id ?? ''],
    selected
      ? `/api/tenant/ai/insights?entity_type=${selected.entity_type}&entity_id=${selected.id}`
      : '/api/tenant/ai/insights',
    { enabled: !!selected, retry: false },
  );

  function pickType(type: EntityType) {
    setEntityType(type);
    setSelected(null);
    generate.reset();
  }

  function run() {
    if (!selected) {
      setError('Pick a contact or deal first.');
      return;
    }
    generate.mutate();
    saved.refetch();
  }

  const insights = generate.data?.insights ?? [];

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shrink-0">
          <Lightbulb className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">AI Insights</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Next-best-action recommendations for a contact or deal. Uses your CRM activity history and falls back to clear heuristics when no AI provider is available.
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex gap-2">
          {(['contact', 'deal'] as const).map((type) => (
            <button key={type} type="button" onClick={() => pickType(type)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border',
                entityType === type ? 'bg-violet-600 text-white border-violet-600' : 'bg-background border-border text-muted-foreground')}>
              {type === 'contact' ? 'Contact' : 'Deal'}
            </button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${entityType}s…`}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        {hits.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {hits.map((hit) => (
              <button key={hit.id} type="button" onClick={() => { setSelected(hit); generate.reset(); }}
                className={cn('text-left rounded-lg border px-3 py-2 text-sm transition-colors',
                  selected?.id === hit.id ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/20' : 'border-border hover:bg-muted/50')}>
                <span className="font-medium">{hit.label}</span>
                {hit.sublabel && <span className="block text-[11px] text-muted-foreground truncate">{hit.sublabel}</span>}
              </button>
            ))}
          </div>
        )}
        {selected && <p className="text-xs text-muted-foreground">Selected: <span className="font-medium text-foreground">{selected.label}</span></p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="button" onClick={run} disabled={generate.isPending || !selected}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generate.isPending ? 'Generating…' : 'Generate insights'}
        </button>
      </div>

      {generate.data && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">
            {generate.data.ai ? 'AI recommendations' : 'Heuristic recommendations'}
          </p>
          {saved.isError ? (
            <InlineErrorState
              message={`Could not load the saved insights for this record: ${saved.error?.message ?? 'no response from the server'}`}
              onRetry={() => void saved.refetch()}
            />
          ) : insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signals found for this record yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {insights.map((insight) => (
                <div key={insight.id || `${insight.type}-${insight.title}`} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{insight.title}</p>
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-bold uppercase', PRIORITY_STYLE[insight.priority] ?? PRIORITY_STYLE.medium)}>
                      {insight.priority}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{insight.content}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-2">{insight.type} · score {String(insight.score)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && (saved.data?.data?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">Saved for this record</p>
          <div className="space-y-1.5">
            {saved.data!.data.map((insight) => (
              <div key={insight.id} className="rounded-lg border bg-card px-4 py-2 text-sm">
                <span className="font-medium">{insight.title}</span>
                <span className="text-xs text-muted-foreground ml-2 line-clamp-1">{insight.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
