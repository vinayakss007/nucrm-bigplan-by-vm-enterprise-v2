'use client';
import { useEffect, useState } from 'react';
import {
  AlertTriangle, Loader2, Search, Filter, ArrowUpRight, 
  MessageSquare, Clock, Zap, Target, ExternalLink, RefreshCcw
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import Link from 'next/link';

type AtRiskDeal = {
  id: string;
  title: string;
  amount: string;
  stageName: string;
  contactName: string;
  companyName: string;
  atRisk: {
    reasons: string[];
    severity: 'high' | 'medium' | 'low';
    idleDays: number;
    stageDays: number;
    currentSentiment: number;
  };
};

export default function AIAtRiskPage() {
  const [deals, setDeals] = useState<AtRiskDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  function load() {
    setLoading(true);
    setError(null);
    fetch('/api/tenant/ai/at-risk', { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(e => { console.error('[json] parse error:', e); return {}; })).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(d => setDeals(d.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = deals.filter(d => 
    d.title.toLowerCase().includes(q.toLowerCase()) || 
    d.contactName.toLowerCase().includes(q.toLowerCase()) ||
    d.companyName?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            At-Risk Deals
          </h1>
          <p className="text-muted-foreground mt-1">
            Proactive identification of stalled or decaying pipeline deals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={load}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCcw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <Link
            href="/tenant/settings/at-risk-rules"
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors"
          >
            Configure Rules
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Total At-Risk</div>
          </div>
          <div className="text-3xl font-bold">{loading ? '...' : deals.length}</div>
          <div className="text-xs text-muted-foreground mt-2">
            Deals matching your detection rules
          </div>
        </div>

        <div className="bg-card border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-destructive" />
            </div>
            <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">High Severity</div>
          </div>
          <div className="text-3xl font-bold text-destructive">
            {loading ? '...' : deals.filter(d => d.atRisk.severity === 'high').length}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Multiple risk factors detected
          </div>
        </div>

        <div className="bg-card border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Risk Value</div>
          </div>
          <div className="text-3xl font-bold">
            {loading ? '...' : formatCurrency(deals.reduce((sum, d) => sum + parseFloat(d.amount || '0'), 0))}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Total amount in stalled deals
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 bg-card border rounded-xl px-4 py-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input 
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Filter by deal, contact or company..."
          className="flex-1 bg-transparent border-none outline-none text-sm py-2"
        />
        <Filter className="w-4 h-4 text-muted-foreground" />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin mb-4" />
          <p>Analyzing pipeline...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-20 text-center bg-card border border-dashed rounded-3xl">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <Zap className="w-8 h-8 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold">Pipeline Healthy</h2>
          <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
            No deals currently match your at-risk criteria. Great job keeping the momentum!
          </p>
        </div>
      ) : (
        <div className="bg-card border rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Deal</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Risk Factors</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Stats</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Value</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((deal) => (
                <tr key={deal.id} className="group hover:bg-muted/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <Link 
                        href={`/tenant/deals/${deal.id}`}
                        className="font-bold text-primary hover:underline flex items-center gap-1.5"
                      >
                        {deal.title}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {deal.contactName} @ {deal.companyName || 'Unknown'}
                      </div>
                      <div className="inline-flex px-2 py-0.5 rounded-md bg-muted text-[10px] font-bold uppercase tracking-wider border">
                        {deal.stageName}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-2">
                      {deal.atRisk.reasons.map((reason, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-destructive font-medium">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          {reason}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="text-center" title="Days since activity">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase">Idle</div>
                        <div className={cn("text-sm font-bold", deal.atRisk.idleDays > 30 ? "text-destructive" : "text-amber-600")}>
                          {deal.atRisk.idleDays}d
                        </div>
                      </div>
                      <div className="text-center" title="Days in stage">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase">Stuck</div>
                        <div className="text-sm font-bold">{deal.atRisk.stageDays}d</div>
                      </div>
                      <div className="text-center" title="AI Sentiment Score">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase">Mood</div>
                        <div className={cn(
                          "text-sm font-bold",
                          deal.atRisk.currentSentiment < 30 ? "text-destructive" : "text-emerald-600"
                        )}>
                          {deal.atRisk.currentSentiment}%
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-bold">{formatCurrency(deal.amount)}</div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                        title="Nudge Owner"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                      </button>
                      <button 
                        className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                        title="Quick Note"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
