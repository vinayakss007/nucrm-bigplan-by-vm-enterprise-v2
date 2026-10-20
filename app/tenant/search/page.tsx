/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiQueryError, useApiQuery } from '@/lib/query/client';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, Users, TrendingUp, Building2, CheckSquare, Loader2, X, Target } from 'lucide-react';
import { cn, apiFetch } from '@/lib/utils';
import { AdvancedSearchFilters } from '@/components/tenant/advanced-search';
import Pagination from '@/components/tenant/pagination';
import { ListSkeleton } from '@/components/shared/page-skeleton';
import InlineErrorState from '@/components/shared/inline-error-state';
import {
  SearchResultGroups,
  type SearchResults,
  type SearchRow,
} from '@/components/tenant/search-result-groups';

interface SearchFilters {
  status?: string[];
  stage?: string[];
  source?: string[];
  industry?: string[];
  priority?: string[];
  dateFrom?: string;
  dateTo?: string;
  valueMin?: number;
  valueMax?: number;
  tags?: string[];
}

interface AdvancedPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

/** `/api/tenant/search/advanced` answers one type at a time, flat. */
interface AdvancedSearchResponse {
  data: SearchRow[];
  pagination: AdvancedPagination;
}

/**
 * The request the rows on screen actually answer. Kept apart from `query` /
 * `filters`, which are the panel being edited: the list must not silently
 * change meaning while a chip is being toggled, and the rows have to be
 * attributable to the exact body that produced them.
 */
interface SubmittedSearch {
  type: string;
  query: string;
  filters: SearchFilters;
  page: number;
}

/** Rows per advanced-search page. The route caps it at 100; 25 is the panel's. */
const ADVANCED_LIMIT = 25;

function SearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchParams.get('q') ?? '');
  const [activeType, setActiveType] = useState('all');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const [editedAfterApply, setEditedAfterApply] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // #1328: quick search via TanStack Query (was a debounced fetch in an
  // effect). The debounced term + type form the key so results cache per query
  // and stale requests are superseded automatically. While a filtered answer is
  // on screen the typeahead stands down: its rows are not what the page is
  // showing, and letting it fetch would flash "Searching…" over an answer that
  // did not change.
  const trimmed = debouncedQuery.trim();
  const quickQuery = useApiQuery<SearchResults>(
    ['tenant', 'search', activeType, trimmed],
    `/api/tenant/search?${new URLSearchParams({ q: trimmed, type: activeType, limit: '12' })}`,
    { enabled: trimmed.length > 0 && submitted === null },
  );
  const quickResults = quickQuery.data ?? null;
  // #2872: `isFetching` is also true while a key that already answered is being revalidated, so
  // this swapped a live result set for "Searching…" on every re-entry with `q` in the URL — the
  // term and the type are the key, so re-entry re-runs the read the answer on screen came from. Only
  // a term nothing has answered yet has no set to show.
  const loadingQuery = quickQuery.isLoading && trimmed.length > 0;
  const quickFailed = Boolean(quickQuery.error) && !quickQuery.data;   // never answered for this term
  const quickStale = Boolean(quickQuery.error) && Boolean(quickQuery.data); // refused revalidation
  const quickReason = quickQuery.error?.message || 'no response from the server';

  // Sync the input from the URL and focus on mount.
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) { setQuery(q); setDebouncedQuery(q); }
    inputRef.current?.focus();
  }, [searchParams]);

  const handleInput = (val: string) => {
    setQuery(val);
    if (submitted) setEditedAfterApply(true);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setDebouncedQuery(''); setSubmitted(null); setEditedAfterApply(false); return; }
    timerRef.current = setTimeout(() => {
      router.replace(`/tenant/search?q=${encodeURIComponent(val)}`, { scroll: false });
      setDebouncedQuery(val);
    }, 300);
  };

  const handleTypeChange = (type: string) => {
    setActiveType(type);
    setEditedAfterApply(false);
    // Filtered rows belong to the type that was asked for. Switching tabs
    // under them would re-labour someone else's answer as this one's (#2838).
    setSubmitted(null);
  };

  // The panel edits `query` / `filters`; `submitted` is what the rows answer.
  // Editing after applying is flagged rather than guessed at, so the hint is
  // only ever shown when the chips genuinely outran the list (#2838).
  const handleQueryChange = (val: string) => { setQuery(val); setEditedAfterApply(submitted !== null); };
  const handleFiltersChange = (f: SearchFilters) => { setFilters(f); setEditedAfterApply(submitted !== null); };

  // #2838: the Filters panel has POSTed here since #2690, and the response went
  // into a `_advancedResults` variable that nothing read — so the list kept
  // showing the unfiltered typeahead rows underneath chips that claimed a
  // filter. It is a query, not a mutation: the submitted body is the cache key,
  // so the rows on screen are attributable to a request, a re-run supersedes
  // the stale one, and a non-2xx is an `error` rather than an empty `data`.
  const advancedQuery = useQuery<AdvancedSearchResponse, ApiQueryError>({
    queryKey: ['tenant', 'search', 'advanced', submitted],
    queryFn: async () => {
      if (!submitted) throw new ApiQueryError('No search has been submitted.', 400, {});
      const res = await apiFetch('/api/tenant/search/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          query: submitted.query || undefined,
          type: submitted.type,
          filters: submitted.filters,
          page: submitted.page,
          limit: ADVANCED_LIMIT,
        }),
      });
      if (!res.ok) {
        const info = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiQueryError(
          typeof info?.error === 'string' ? info.error : `Search failed (${res.status})`,
          res.status,
          info,
        );
      }
      return res.json() as Promise<AdvancedSearchResponse>;
    },
    enabled: submitted !== null,
    retry: 0,
  });
  // #2872: nothing on this page writes, so the refusal here is never a mutation's
  // `invalidateQueries` — it is the same key asked again. `submitted` (term, type, chips and page,
  // all of it) *is* the advanced key, and `[type, term]` is the typeahead's, so pressing "Try
  // again", re-entering `/tenant/search?q=…` past the 30-second stale window, or TanStack's
  // reconnect revalidation re-runs a read that already answered. When that re-run is refused
  // `useQuery` keeps the answer it had, and the page read only the flag: the outage banner — "did
  // not run", "nothing was counted" — sat over the rows or the counted zero still on screen, which
  // is the same false all-clear inverted. Paging or re-filtering makes a NEW key, so that view
  // stays a failure; only a refused re-run of the key on screen is a last read.
  const advancedFailed = Boolean(advancedQuery.error) && !advancedQuery.data;
  const advancedStale = Boolean(advancedQuery.error) && Boolean(advancedQuery.data);
  const advancedReason = advancedQuery.error?.message || 'no response from the server';

  const advancedSearch = () => {
    if (!query.trim() && Object.keys(filters).length === 0) return;
    if (activeType === 'all') return; // Advanced search requires a specific type
    setSubmitted({ type: activeType, query: query.trim(), filters, page: 1 });
    setEditedAfterApply(false);
  };

  const setAdvancedPage = (next: number) => {
    setSubmitted((s) => (s ? { ...s, page: Math.max(1, next) } : s));
  };

  // Which rows the page is allowed to speak for: the filtered set once an
  // advanced search has answered, otherwise the typeahead. While the filtered
  // one is in flight or has failed there is no set, and the arms below say so
  // instead of reusing the previous answer.
  const groups: SearchResults | null = submitted
    ? (advancedQuery.data ? ({ [submitted.type]: advancedQuery.data.data } as SearchResults) : null)
    : quickResults;
  // Tab chips are navigation, so they may fall back to the typeahead's counts
  // while the filtered read is in flight; the panels below never mix sources.
  const view = groups ?? quickResults;
  const loading = loadingQuery || (submitted !== null && advancedQuery.isPending);
  const countOf = (r: SearchResults | null) => (r?.contacts?.length ?? 0) + (r?.leads?.length ?? 0) + (r?.deals?.length ?? 0) + (r?.companies?.length ?? 0) + (r?.tasks?.length ?? 0);
  const total = countOf(groups);
  const quickTotal = countOf(quickResults);
  const pagination = submitted ? advancedQuery.data?.pagination : undefined;

  const TYPES = [
    { id:'all', label:'All', count: groups ? total : quickTotal },
    { id:'contacts', label:'Contacts', count: view?.contacts?.length ?? 0, icon: Users },
    { id:'leads', label:'Leads', count: view?.leads?.length ?? 0, icon: Target },
    { id:'deals', label:'Deals', count: view?.deals?.length ?? 0, icon: TrendingUp },
    { id:'companies', label:'Companies', count: view?.companies?.length ?? 0, icon: Building2 },
    { id:'tasks', label:'Tasks', count: view?.tasks?.length ?? 0, icon: CheckSquare },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold">Search</h1>
        <p className="text-sm text-muted-foreground">Search across contacts, deals, companies and tasks</p>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => handleInput(e.target.value)}
          placeholder="Search everything... (contacts, deals, companies, tasks)"
          className="w-full pl-12 pr-12 py-3.5 text-base bg-card border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-500 shadow-sm"
          autoFocus
        />
        {query && (
          <button onClick={() => { setQuery(''); setDebouncedQuery(''); setSubmitted(null); setEditedAfterApply(false); inputRef.current?.focus(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Type filter tabs */}
      {view && (
        <div className="flex gap-1 flex-wrap">
          {TYPES.map(t => (
            <button key={t.id} onClick={() => handleTypeChange(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border',
                activeType === t.id ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-accent')}>
              {t.icon && <t.icon className="w-3.5 h-3.5" />}
              {t.label}
              {t.count > 0 && <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-bold', activeType === t.id ? 'bg-white/20' : 'bg-muted')}>{t.count}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Advanced Filters (shown when a specific type is selected) */}
      {activeType !== 'all' && (
        <AdvancedSearchFilters
          type={activeType}
          query={query}
          filters={filters}
          onQueryChange={handleQueryChange}
          onFiltersChange={handleFiltersChange}
          onSearch={advancedSearch}
        />
      )}

      {editedAfterApply && submitted && !loading && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          The list below still answers the search that was applied — not the term
          and chips showing now. Press Apply Filters to ask this one.
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />Searching...
        </div>
      )}

      {/* #2829/#2838: a search that did not succeed has to look different from
          one that succeeded and matched nothing — and different from showing
          nothing at all, which is what a failed typeahead used to render.
          #2872 splits the first of those in two: this arm is the filtered
          request that has never answered for the body on the chips. */}
      {submitted && !loading && advancedFailed && (
        <InlineErrorState
          message={`The filtered ${submitted.type} search did not run: ${advancedReason}. Whether anything matches these filters is still unknown.`}
          onRetry={() => void advancedQuery.refetch()}
        />
      )}

      {/* Same key, refused re-run: the filtered answer stays and is labelled as the last read. */}
      {submitted && !loading && advancedStale && (
        <InlineErrorState
          message={`Could not re-run the filtered ${submitted.type} search, so the answer below is the last read: ${advancedReason}. Anything created, edited or deleted since that read is not reflected in it.`}
          onRetry={() => void advancedQuery.refetch()}
        />
      )}

      {!submitted && trimmed.length > 0 && quickFailed && (
        <InlineErrorState
          message={`Search failed: ${quickReason}. These are not "no results" — nothing was counted.`}
          onRetry={() => void quickQuery.refetch()}
        />
      )}

      {/* The term this key already answered, asked again and refused: the rows it counted stay. */}
      {!submitted && trimmed.length > 0 && quickStale && (
        <InlineErrorState
          message={`Could not refresh the search for "${trimmed}", so the results below are the last read: ${quickReason}. Anything created since that read is not in them.`}
          onRetry={() => void quickQuery.refetch()}
        />
      )}

      {groups && !loading && total === 0 && (
        <div className="text-center py-16">
          <Search className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-base font-semibold">
            {submitted ? `No ${submitted.type} match this search` : `No results for "${query}"`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {submitted
              ? 'The request succeeded and counted nothing. Widen a filter, or clear the term.'
              : 'Try a different search term or check the spelling'}
          </p>
        </div>
      )}

      {/* The route counted the whole match; this page holds one slice of it.
          The app's shared control says which slice and asks for another (#2838). */}
      {pagination && !loading && (
        <Pagination
          total={pagination.total}
          offset={(pagination.page - 1) * pagination.limit}
          limit={pagination.limit}
          onChange={(offset) => setAdvancedPage(Math.floor(offset / pagination.limit) + 1)}
        />
      )}

      {groups && !loading && total > 0 && (
        <SearchResultGroups query={query} activeType={activeType} groups={groups} />
      )}

      {!query && !loading && !submitted && (
        <div className="text-center py-16">
          <Search className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-base font-semibold text-muted-foreground">Start typing to search</p>
          <p className="text-sm text-muted-foreground/60 mt-1">Search contacts by name, email, phone or company</p>
        </div>
      )}
    </div>
  );
}


/**
 * useSearchParams() suspends. Without a boundary around it, Next.js bails the
 * whole route out of prerendering into client-side rendering and emits a build
 * warning, so the page shipped with no server-rendered HTML at all.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <SearchPageContent />
    </Suspense>
  );
}
