'use client';
import { useEffect, useState } from 'react';
import {
  Target, RefreshCw, Sparkles, AlertCircle, Loader2, ChevronRight, User, TrendingUp,
  History, Settings, Play, CheckCircle2,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type ScoredLead = {
  contactId: string;
  score: number;
  firstName: string;
  lastName: string;
  email: string;
  lastScoredAt: string;
};

export default function LeadScoringPage() {
  const [leads, setLeads] = useState<ScoredLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, avg: 0, high: 0 });

  function load() {
    setLoading(true);
    fetch('/api/tenant/ai/score?limit=10')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(body => {
        setLeads(body.data || []);
        // Calculate basic stats from top 10
        if (body.data?.length > 0) {
          const avg = body.data.reduce((acc: number, l: any) => acc + l.score, 0) / body.data.length;
          const high = body.data.filter((l: any) => l.score >= 80).length;
          setStats({ total: body.data.length, avg: Math.round(avg), high });
        }
      })
      .catch(() => setError('Failed to load scored leads'))
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

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-600" /> AI Lead Scoring
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Automatically rank leads based on engagement, firmographics, and your custom scoring rules. High-scoring leads are pushed to the top of your queue.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/tenant/settings/lead-scoring" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm">
            <Settings className="w-3.5 h-3.5" /> Rules
          </Link>
          <button
            onClick={runScoring}
            disabled={running || loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm disabled:opacity-50"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run scoring now
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={TrendingUp} label="Avg. Score" value={stats.avg} sub="Top 10 leads" />
        <StatCard icon={Sparkles} label="High Intent" value={stats.high} sub="Score 80+" />
        <StatCard icon={History} label="Last Run" value="Today" sub="Automated nightly" />
      </div>

      {/* Top Scored Leads */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">Top priority leads</h2>
        
        {loading && leads.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Fetching your lead queue...</p>
          </div>
        )}

        {!loading && leads.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
            <Target className="w-8 h-8 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No leads have been scored yet.</p>
            <button onClick={runScoring} className="text-blue-600 hover:underline text-sm font-medium mt-2">Click "Run scoring now" to start.</button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          {leads.map((l) => (
            <Link key={l.contactId} href={`/tenant/contacts/${l.contactId}`} className="group flex items-center gap-4 px-4 py-3 rounded-xl border border-border bg-card hover:border-blue-300 hover:bg-blue-50/30 transition-all">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm",
                l.score >= 80 ? "bg-emerald-100 text-emerald-700" :
                l.score >= 50 ? "bg-blue-100 text-blue-700" :
                "bg-slate-100 text-slate-600"
              )}>
                {l.score}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate group-hover:text-blue-700">{l.firstName} {l.lastName}</p>
                <p className="text-[11px] text-muted-foreground truncate">{l.email}</p>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Priority</p>
                <p className={cn("text-xs font-medium",
                  l.score >= 80 ? "text-emerald-600" : l.score >= 50 ? "text-blue-600" : "text-slate-500"
                )}>
                  {l.score >= 80 ? 'High' : l.score >= 50 ? 'Medium' : 'Standard'}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          ))}
        </div>
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
