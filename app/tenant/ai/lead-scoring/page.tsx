'use client';
import { useEffect, useState } from 'react';
import {
  Target, RefreshCw, Sparkles, AlertCircle, Loader2, ChevronRight, User, TrendingUp,
  History, Settings, Play, CheckCircle2, TrendingDown, Minus,
  Building2, Mail, ExternalLink, Wand2
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type Lead = {
  id: string;
  contactId?: string;
  firstName: string;
  lastName: string;
  email: string | null;
  companyName: string | null;
  score: number | null;
  leadStatus: string;
  lastScoredAt?: string;
  metadata?: {
    ai_scoring?: {
      reason: string;
      next_action: string;
    }
  }
};

export default function AILeadScoringPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, avg: 0, high: 0 });

  function load() {
    setLoading(true);
    setError(null);
    fetch('/api/tenant/leads?sort_by=score&sort_order=DESC&limit=100', { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        const data = d.leads || [];
        setLeads(data);
        if (data.length > 0) {
          const avg = Math.round(data.reduce((acc: number, l: Lead) => acc + (l.score ?? 0), 0) / data.length);
          const high = data.filter((l: Lead) => (l.score ?? 0) >= 80).length;
          setStats({ total: data.length, avg, high });
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function runScoring() {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch('/api/tenant/ai/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk: true, limit: 5 }),
      });
      if (!r.ok) throw new Error('Scoring run failed');
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setRunning(false); }
  }

  async function recomputeAll() {
    setBusy('recompute');
    try {
      const r = await fetch('/api/tenant/admin/lead-scoring/recompute', { method: 'POST' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <Target className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">AI Lead Scoring</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Automatically rank leads based on engagement, firmographics, and your custom scoring rules. High-scoring leads are pushed to the top of your queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runScoring}
            disabled={running || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm disabled:opacity-50"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run scoring now
          </button>
          <button
            onClick={recomputeAll}
            disabled={busy === 'recompute' || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm"
          >
            {busy === 'recompute' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh scores
          </button>
          <Link
            href="/tenant/settings/lead-scoring"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
          >
            Edit rules
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={TrendingUp} label="Avg. Score" value={stats.avg} sub="Leads scored" />
        <StatCard icon={Sparkles} label="High Intent" value={stats.high} sub="Score 80+" />
        <StatCard icon={History} label="Scored Leads" value={stats.total} sub="Total ranked" />
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading && !leads.length && (
          <div className="py-20 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Ranking leads...</p>
          </div>
        )}

        {!loading && leads.length === 0 && (
          <div className="py-20 text-center border border-dashed border-border rounded-2xl bg-muted/20">
            <Target className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No leads found to score.</p>
            <button onClick={runScoring} className="text-violet-600 text-sm hover:underline mt-2 inline-block">Run scoring now</button>
          </div>
        )}

        {leads.map((lead, i) => (
          <LeadCard key={lead.id} lead={lead} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: any, label: string, value: string | number, sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function LeadCard({ lead, rank }: { lead: Lead; rank: number }) {
  const score = lead.score ?? 0;
  const analysis = lead.metadata?.ai_scoring;

  return (
    <div className="group bg-card border border-border hover:border-violet-500/50 rounded-2xl p-4 transition-all hover:shadow-md relative overflow-hidden">
      <div className="absolute top-0 left-0 w-8 h-8 bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground group-hover:bg-violet-500 group-hover:text-white transition-colors rounded-br-xl">
        #{rank}
      </div>

      <div className="flex flex-col md:flex-row gap-5 pl-6">
        <div className="flex flex-col items-center justify-center shrink-0 py-2">
          <div className={cn(
            "w-16 h-16 rounded-full border-4 flex flex-col items-center justify-center",
            score >= 80 ? "border-emerald-500 text-emerald-600 dark:text-emerald-400" :
            score >= 50 ? "border-amber-500 text-amber-600 dark:text-amber-400" :
            "border-zinc-300 text-zinc-500 dark:border-zinc-800"
          )}>
            <span className="text-xl font-black leading-none">{score}</span>
            <span className="text-[8px] uppercase font-bold">score</span>
          </div>
          <div className="mt-2 flex items-center gap-1">
            {score >= 80 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : 
             score <= 30 ? <TrendingDown className="w-3 h-3 text-red-500" /> : 
             <Minus className="w-3 h-3 text-amber-500" />}
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {score >= 80 ? 'Hot' : score >= 50 ? 'Warm' : 'Cold'}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-bold truncate">
              {lead.firstName} {lead.lastName}
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-bold uppercase tracking-wider">
              {lead.leadStatus}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lead.companyName && (
              <div className="flex items-center gap-1.5 truncate">
                <Building2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{lead.companyName}</span>
              </div>
            )}
            {lead.email && (
              <div className="flex items-center gap-1.5 truncate">
                <Mail className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{lead.email}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 bg-muted/30 dark:bg-muted/10 rounded-xl p-3 border border-border/50">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Wand2 className="w-3 h-3 text-violet-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">AI Insights</span>
          </div>
          {analysis ? (
            <div className="space-y-2">
              <p className="text-xs text-foreground/80 leading-relaxed italic">
                &ldquo;{analysis.reason}&rdquo;
              </p>
              <div className="pt-1 border-t border-border/50">
                <p className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-tight">Next best action:</p>
                <p className="text-xs font-medium">{analysis.next_action}</p>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              No detailed analysis available. Click &ldquo;Refresh scores&rdquo; to generate insights.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 shrink-0">
          <Link
            href={`/tenant/leads/${lead.id}`}
            className="p-2 rounded-lg border border-border hover:bg-accent transition-colors"
            title="View lead"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
