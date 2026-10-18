/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import Link from 'next/link';
import { Users, TrendingUp, Building2, CheckSquare, Target } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

/**
 * The row markup behind a search answer (#2838).
 *
 * Both of the page's sources feed this one component: the typeahead GET returns
 * the grouped shape directly, and the filtered POST returns a flat single-type
 * row set that the page wraps into the same shape. That is deliberate — two
 * renderers for the same rows is how the filtered answer ended up with nowhere
 * to go the first time. It also means the two endpoints have to agree on field
 * values: `deals.stage` is a stage *name*, not a uuid, and a company carries a
 * `contact_count`; the advanced route was corrected to match.
 */

export interface SearchResultContact {
  id: string; first_name: string; last_name: string;
  email?: string; company_name?: string; lead_status: string;
}
export interface SearchResultLead {
  id: string; first_name: string; last_name: string;
  email?: string; company_name?: string; lead_status: string;
}
export interface SearchResultDeal {
  id: string; title: string;
  first_name?: string; last_name?: string;
  value: number; stage: string;
}
export interface SearchResultCompany {
  id: string; name: string;
  industry?: string; contact_count: number;
}
export interface SearchResultTask {
  id: string; title: string;
  first_name?: string; last_name?: string;
  due_date?: string; completed: boolean; priority: string;
}
export type SearchRow =
  | SearchResultContact
  | SearchResultLead
  | SearchResultDeal
  | SearchResultCompany
  | SearchResultTask;

export interface SearchResults {
  contacts?: SearchResultContact[];
  leads?: SearchResultLead[];
  deals?: SearchResultDeal[];
  companies?: SearchResultCompany[];
  tasks?: SearchResultTask[];
}

const STATUS_COLORS: Record<string,string> = {
  new:'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', contacted:'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  qualified:'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', converted:'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  lost:'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', unqualified:'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};
const STAGE_COLORS: Record<string,string> = {
  lead:'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', qualified:'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  proposal:'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', negotiation:'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  won:'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', lost:'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
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

export function SearchResultGroups({ query, activeType, groups }: { query: string; activeType: string; groups: SearchResults }) {
  return (
    <div className="space-y-5">
      {/* Contacts */}
      {(activeType === 'all' || activeType === 'contacts') && (groups.contacts?.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Contacts</h2>
            <span className="text-xs text-muted-foreground">({groups.contacts?.length})</span>
          </div>
          <div className="admin-card divide-y divide-border overflow-hidden">
            {groups.contacts?.map((c: SearchResultContact) => (
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
      {(activeType === 'all' || activeType === 'leads') && (groups.leads?.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Leads</h2>
            <span className="text-xs text-muted-foreground">({groups.leads?.length})</span>
          </div>
          <div className="admin-card divide-y divide-border overflow-hidden">
            {groups.leads?.map((l: SearchResultLead) => (
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
      {(activeType === 'all' || activeType === 'deals') && (groups.deals?.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Deals</h2>
            <span className="text-xs text-muted-foreground">({groups.deals?.length})</span>
          </div>
          <div className="admin-card divide-y divide-border overflow-hidden">
            {groups.deals?.map((d: SearchResultDeal) => (
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
      {(activeType === 'all' || activeType === 'companies') && (groups.companies?.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Companies</h2>
            <span className="text-xs text-muted-foreground">({groups.companies?.length})</span>
          </div>
          <div className="admin-card divide-y divide-border overflow-hidden">
            {groups.companies?.map((c: SearchResultCompany) => (
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
      {(activeType === 'all' || activeType === 'tasks') && (groups.tasks?.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CheckSquare className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Tasks</h2>
            <span className="text-xs text-muted-foreground">({groups.tasks?.length})</span>
          </div>
          <div className="admin-card divide-y divide-border overflow-hidden">
            {groups.tasks?.map((t: SearchResultTask) => {
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
  );
}
