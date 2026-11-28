/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Mail, Loader2, Sparkles, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchJsonOrThrow } from '@/lib/fetch-json';

type EntityType = 'contact' | 'deal';
type Hit = { id: string; label: string; sublabel?: string; entity_type: EntityType };
type Draft = {
  id: string;
  subject: string;
  body: string;
  purpose: string;
  tone: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  createdAt: string;
};
type GenerateResp = { ok: boolean; draft: Draft; subject: string; body: string; provider: string; model: string };

const SEARCH_URL: Record<EntityType, string> = {
  contact: '/api/tenant/contacts?limit=8&search=',
  deal: '/api/tenant/deals?limit=8&search=',
};
const PURPOSES = ['follow_up', 'introduction', 'check_in', 'proposal', 'closing'];
const TONES = ['professional', 'warm', 'casual', 'concise'];
const LENGTHS = ['short', 'medium', 'long'];

type SearchRow = { id: string; firstName?: string; lastName?: string; email?: string; title?: string };
type SearchResp = { contacts?: SearchRow[]; deals?: SearchRow[]; data?: SearchRow[] };

export default function AIEmailDraftsPage() {
  const [entityType, setEntityType] = useState<EntityType>('contact');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Hit | null>(null);
  const [purpose, setPurpose] = useState('follow_up');
  const [tone, setTone] = useState('professional');
  const [length, setLength] = useState('medium');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const searchQuery = useApiQuery<SearchResp>(
    ['tenant', 'ai', 'email-draft-search', entityType, debounced],
    SEARCH_URL[entityType] + encodeURIComponent(debounced),
  );

  const hits = useMemo((): Hit[] => {
    const rows = searchQuery.data?.contacts ?? searchQuery.data?.deals ?? searchQuery.data?.data ?? [];
    return rows.slice(0, 8).map((row) => entityType === 'contact'
      ? {
          id: row.id,
          entity_type: 'contact',
          label: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || row.email || '—',
          sublabel: row.email,
        }
      : { id: row.id, entity_type: 'deal', label: row.title || '—' });
  }, [searchQuery.data, entityType]);

  const generate = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = {
        purpose,
        tone,
        length,
        ...(entityType === 'contact' ? { contact_id: selected!.id } : { deal_id: selected!.id }),
      };
      if (instructions.trim()) payload.custom_instructions = instructions.trim();
      return fetchJsonOrThrow<GenerateResp>('/api/tenant/ai/email-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onMutate: () => { setError(null); setCopied(false); },
    onSuccess: () => { saved.refetch(); },
    onError: (e: Error) => setError(e.message),
  });

  const saved = useApiQuery<{ data: Draft[] }>(
    ['tenant', 'ai', 'email-drafts'],
    '/api/tenant/ai/email-draft?limit=20',
    { retry: false },
  );

  function run() {
    if (!selected) {
      setError('Pick a contact or deal first.');
      return;
    }
    generate.mutate();
  }

  async function copy() {
    const data = generate.data;
    if (!data) return;
    try {
      await navigator.clipboard.writeText(`${data.subject}\n\n${data.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard is unavailable in this browser.');
    }
  }

  const result = generate.data;

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <Mail className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">AI Email Drafts</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Write a context-aware email from a contact or deal record. Every generated draft is saved so you can review it before sending.
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex gap-2">
          {(['contact', 'deal'] as const).map((type) => (
            <button key={type} type="button"
              onClick={() => { setEntityType(type); setSelected(null); generate.reset(); }}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="text-xs text-muted-foreground">Purpose
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground">
              {PURPOSES.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Tone
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground">
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Length
            <select value={length} onChange={(e) => setLength(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground">
              {LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)}
          placeholder="Extra instructions (optional)" rows={2}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="button" onClick={run} disabled={generate.isPending || !selected}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generate.isPending ? 'Writing…' : 'Generate draft'}
        </button>
      </div>

      {result && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">{result.subject}</p>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap mt-3">{result.body}</p>
          <p className="text-[10px] text-muted-foreground mt-3">{result.provider} · {result.model} · saved to drafts</p>
        </div>
      )}

      {(saved.data?.data?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">Saved drafts</p>
          <div className="space-y-1.5">
            {saved.data!.data.map((draft) => (
              <div key={draft.id} className="rounded-lg border bg-card px-4 py-2">
                <p className="text-sm font-medium truncate">{draft.subject}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{draft.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
