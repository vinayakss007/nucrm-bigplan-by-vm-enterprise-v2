'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Users, TrendingUp, Building2, CheckSquare, Loader2, X, Target } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { AdvancedSearchFilters } from '@/components/tenant/advanced-search';

const STATUS_COLORS: Record<string,string> = {
  new:'bg-slate-100 text-slate-600', contacted:'bg-blue-100 text-blue-700',
  qualified:'bg-violet-100 text-violet-700', converted:'bg-emerald-100 text-emerald-700',
  lost:'bg-gray-100 text-gray-500', unqualified:'bg-red-100 text-red-600',
};
const STAGE_COLORS: Record<string,string> = {
  lead:'bg-slate-100 text-slate-600', qualified:'bg-blue-100 text-blue-700',
  proposal:'bg-violet-100 text-violet-700', negotiation:'bg-amber-100 text-amber-700',
  won:'bg-emerald-100 text-emerald-700', lost:'bg-red-100 text-red-600',
};

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return <>
    {text.slice(0, idx)}
    <mark className="bg-violet-200 dark:bg-violet-800/60 text-violet-900 dark:text-violet-100 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
    {text.slice(idx + query.length)}
  </>;
}

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeType, setActiveType] = useState('all');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [filters, setFilters] = useState<Record<string, any>>({});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [advancedResults, setAdvancedResults] = useState<any>(null);
  const [advancedTotal, setAdvancedTotal] = useState(0);
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const search = useCallback(async (q: string, type = activeType) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    const params = new URLSearchParams({ q, type, limit: '12' });
    const res = await fetch('/api/tenant/search?' + params);
    const data = await res.json();
    setResults(data);
    setLoading(false);
  }, [activeType]);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) { setQuery(q); search(q); }
    inputRef.current?.focus();
  }, [, search]);

  const handleInput = (val: string) => {
    setQuery(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setResults(null); return; }
    timerRef.current = setTimeout(() => {
      router.replace(`/tenant/search?q=${encodeURIComponent(val)}`, { scroll: false });
      search(val);
    }, 300);
  };

  const handleTypeChange = (type: string) => {
    setActiveType(type);
    if (query.trim()) search(query, type);
  };

  // Advanced search with filters
  const advancedSearch = useCallback(async () => {
    if (!query.trim() && Object.keys(filters).length === 0) return;
    if (activeType === 'all') return; // Advanced search requires a specific type
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/search/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query: query.trim() || undefined, type: activeType, filters, page, limit: 25 }),
      });
      const data = await res.json();
      setAdvancedResults(data.data ?? []);
      setAdvancedTotal(data.pagination?.total ?? 0);
    } catch (err) {
      console.error('[AdvancedSearch] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [query, activeType, filters, page]);

  const total = results ? (results.contacts?.length ?? 0) + (results.leads?.length ?? 0) + (results.deals?.length ?? 0) + (results.companies?.length ?? 0) + (results.tasks?.length ?? 0) : 0;

  const TYPES = [
    { id:'all', label:'All', count: total },
    { id:'contacts', label:'Contacts', count: results?.contacts?.length ?? 0, icon: Users },
    { id:'leads', label:'Leads', count: results?.leads?.length ?? 0, icon: Target },
    { id:'deals', label:'Deals', count: results?.deals?.length ?? 0, icon: TrendingUp },
    { id:'companies', label:'Companies', count: results?.companies?.length ?? 0, icon: Building2 },
    { id:'tasks', label:'Tasks', count: results?.tasks?.length ?? 0, icon: CheckSquare },
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
          <button onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Type filter tabs */}
      {results && (
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
          onQueryChange={setQuery}
          onFiltersChange={setFilters}
          onSearch={advancedSearch}
        />
      )}

      {loading && (
        <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />Searching...
        </div>
      )}

      {results && !loading && total === 0 && (
        <div className="text-center py-16">
          <Search className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-base font-semibold">No results for "{query}"</p>
          <p className="text-sm text-muted-foreground mt-1">Try a different search term or check the spelling</p>
        </div>
      )}

      {results && !loading && total > 0 && (
        <div className="space-y-5">
          {/* Contacts */}
          {(activeType === 'all' || activeType === 'contacts') && results.contacts?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Contacts</h2>
                <span className="text-xs text-muted-foreground">({results.contacts.length})</span>
              </div>
              <div className="admin-card divide-y divide-border overflow-hidden">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {results.contacts.map((c: any) => (
                  <Link key={c.id} href={`/tenant/contacts/${c.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {c.first_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        <Highlight text={`${c.first_name} ${c.last_name}`} query={query} />
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {c.email && <span className="text-xs text-muted-foreground truncate"><Highlight text={c.email} query={query} /></span>}
                        {c.company_name && <span className="text-xs text-muted-foreground">· <Highlight text={c.company_name} query={query} /></span>}
                      </div>
                    </div>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize shrink-0', STATUS_COLORS[c.lead_status] ?? STATUS_COLORS["new"])}>
                      {c.lead_status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Leads (separate table) */}
          {(activeType === 'all' || activeType === 'leads') && results.leads?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Leads</h2>
                <span className="text-xs text-muted-foreground">({results.leads.length})</span>
              </div>
              <div className="admin-card divide-y divide-border overflow-hidden">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {results.leads.map((l: any) => (
                  <Link key={l.id} href={`/tenant/leads/${l.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 text-sm font-bold shrink-0">
                      {l.first_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        <Highlight text={`${l.first_name} ${l.last_name}`} query={query} />
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {l.email && <span className="text-xs text-muted-foreground truncate"><Highlight text={l.email} query={query} /></span>}
                        {l.company_name && <span className="text-xs text-muted-foreground">· <Highlight text={l.company_name} query={query} /></span>}
                      </div>
                    </div>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize shrink-0', STATUS_COLORS[l.lead_status] ?? STATUS_COLORS["new"])}>
                      {l.lead_status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Deals */}
          {(activeType === 'all' || activeType === 'deals') && results.deals?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Deals</h2>
                <span className="text-xs text-muted-foreground">({results.deals.length})</span>
              </div>
              <div className="admin-card divide-y divide-border overflow-hidden">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {results.deals.map((d: any) => (
                  <Link key={d.id} href="/tenant/deals"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                      <TrendingUp className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium"><Highlight text={d.title} query={query} /></p>
                      {(d.first_name || d.last_name) && (
                        <p className="text-xs text-muted-foreground">{d.first_name} {d.last_name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-violet-600">{formatCurrency(Number(d.value))}</span>
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize', STAGE_COLORS[d.stage] ?? STAGE_COLORS["lead"])}>{d.stage}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Companies */}
          {(activeType === 'all' || activeType === 'companies') && results.companies?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Companies</h2>
                <span className="text-xs text-muted-foreground">({results.companies.length})</span>
              </div>
              <div className="admin-card divide-y divide-border overflow-hidden">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {results.companies.map((c: any) => (
                  <Link key={c.id} href={`/tenant/companies/${c.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">
                      {c.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium"><Highlight text={c.name} query={query} /></p>
                      {c.industry && <p className="text-xs text-muted-foreground capitalize">{c.industry}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{c.contact_count} contact{c.contact_count !== 1 ? 's' : ''}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Tasks */}
          {(activeType === 'all' || activeType === 'tasks') && results.tasks?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CheckSquare className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Tasks</h2>
                <span className="text-xs text-muted-foreground">({results.tasks.length})</span>
              </div>
              <div className="admin-card divide-y divide-border overflow-hidden">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {results.tasks.map((t: any) => {
                  const overdue = !t.completed && t.due_date && t.due_date < new Date().toLocaleDateString('en-CA');
                  return (
                    <Link key={t.id} href="/tenant/tasks"
                      className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                      <div className={cn('w-2 h-2 rounded-full shrink-0',
                        t.priority==='high' ? 'bg-red-500' : t.priority==='medium' ? 'bg-amber-500' : 'bg-slate-400')} />
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-medium', t.completed && 'line-through text-muted-foreground')}>
                          <Highlight text={t.title} query={query} />
                        </p>
                        {(t.first_name || t.last_name) && (
                          <p className="text-xs text-muted-foreground">{t.first_name} {t.last_name}</p>
                        )}
                      </div>
                      {t.due_date && (
                        <p className={cn('text-xs shrink-0', overdue ? 'text-red-500 font-semibold' : 'text-muted-foreground')}>
                          {overdue ? '⚠ ' : ''}{formatDate(t.due_date)}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!query && !loading && (
        <div className="text-center py-16">
          <Search className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-base font-semibold text-muted-foreground">Start typing to search</p>
          <p className="text-sm text-muted-foreground/60 mt-1">Search contacts by name, email, phone or company</p>
        </div>
      )}
    </div>
  );
}
