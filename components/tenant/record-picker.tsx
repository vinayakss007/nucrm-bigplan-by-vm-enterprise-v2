/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type RecordKind = 'contact' | 'lead' | 'deal';

interface RecordOption {
  id: string;
  label: string;
  sub?: string;
}

interface RecordRow {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  email?: string | null;
}

function toLabel(kind: RecordKind, row: RecordRow): RecordOption {
  if (kind === 'deal') {
    const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
    return { id: row.id, label: row.title || 'Untitled deal', sub: name || undefined };
  }
  const label = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
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
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      fetch(`${ENDPOINT[kind]}?${params.toString()}`, { signal: controller.signal })
        .then(r => (r.ok ? r.json() : { data: [] }))
        .then(d => {
          if (controller.signal.aborted) return;
          setOptions((d.data ?? []).map((row: RecordRow) => toLabel(kind, row)));
        })
        .catch(e => { if ((e as Error)?.name !== 'AbortError') setOptions([]); })
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
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">
                {loading ? 'Searching…' : 'No matches'}
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
