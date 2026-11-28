/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchJsonSafe } from '@/lib/fetch-json';

export type RecordKind = 'contact' | 'lead' | 'deal';

interface RecordOption {
  id: string;
  label: string;
  sub?: string;
}

interface RecordRow {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  email?: string | null;
}

function toLabel(kind: RecordKind, row: RecordRow): RecordOption {
  if (kind === 'deal') {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    return { id: row.id, label: row.title || 'Untitled deal', sub: name || undefined };
  }
  const label = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return { id: row.id, label: label || row.email || 'Unnamed', sub: label ? (row.email ?? undefined) : undefined };
}

const ENDPOINT: Record<RecordKind, string> = {
  contact: '/api/tenant/contacts',
  lead: '/api/tenant/leads',
  deal: '/api/tenant/deals',
};

/**
 * Searchable typeahead for linking a Contact / Lead / Deal by picking a real
 * record instead of pasting a raw UUID. Fetches a small page from the record's
 * list endpoint (server-side search via ?q=) and returns the selected id.
 */
export function RecordPicker({
  kind,
  value,
  onChange,
  placeholder,
}: {
  kind: RecordKind;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<RecordOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!value) {
      setSelectedLabel(null);
      return;
    }
    const controller = new AbortController();
    void fetchJsonSafe<unknown>(`${ENDPOINT[kind]}/${value}`, { signal: controller.signal })
      .then(result => {
        if (result.status !== 'ok') return;
        const body = result.data as Record<string, unknown> | null;
        if (!body || typeof body !== 'object') return;
        const row = ('data' in body ? body.data : body) as RecordRow | null;
        if (row && typeof row === 'object') setSelectedLabel(toLabel(kind, row).label);
      });
    return () => controller.abort();
  }, [value, kind]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const fetchOptions = useMemo(
    () => (q: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      const params = new URLSearchParams({ limit: '20', offset: '0' });
      if (q.trim()) params.set('q', q.trim());
      fetchJsonSafe<{ data?: RecordRow[] }>(`${ENDPOINT[kind]}?${params.toString()}`, { signal: controller.signal })
        .then(result => {
          if (result.status === 'aborted') return;
          if (result.status === 'ok') {
            setOptions((result.data.data ?? []).map((row) => toLabel(kind, row)));
            setFetchError(false);
          } else setFetchError(true);
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    },
    [kind],
  );

  // Load (and debounce) whenever the dropdown is open and the query changes.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchOptions(query), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, query, fetchOptions]);

  const pick = (opt: RecordOption) => {
    onChange(opt.id);
    setSelectedLabel(opt.label);
    setOpen(false);
    setQuery('');
  };

  const clear = () => {
    onChange('');
    setSelectedLabel(null);
    setQuery('');
  };

  return (
    <div className="relative" ref={boxRef}>
      {value ? (
        <div className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm">
          <span className="truncate">{selectedLabel ?? 'Selected'}</span>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm text-muted-foreground hover:border-violet-400 transition-colors"
        >
          <span className="truncate">{placeholder ?? 'Search…'}</span>
          <ChevronDown className="w-4 h-4 shrink-0" />
        </button>
      )}

      {open && !value && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="w-full bg-transparent text-sm focus:outline-none"
            />
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
          </div>
          <div className="max-h-56 overflow-y-auto">
            {options.length === 0 ? (
              <p className={`px-3 py-3 text-xs text-center ${fetchError && !loading ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`} role={fetchError && !loading ? 'alert' : undefined}>
                {loading ? 'Searching…' : fetchError ? 'Search could not be completed — an empty list here would be a lie.' : 'No matches'}
              </p>
            ) : (
              options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => pick(opt)}
                  className={cn(
                    'w-full text-left px-3 py-2 hover:bg-accent transition-colors',
                    'flex flex-col gap-0.5',
                  )}
                >
                  <span className="text-sm font-medium truncate">{opt.label}</span>
                  {opt.sub && <span className="text-xs text-muted-foreground truncate">{opt.sub}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
