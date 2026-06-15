'use client';
import { useState, useEffect } from 'react';
import { TrendingUp, DollarSign, BarChart3, Target } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getStageProbability, calculateWeightedValue } from '@/lib/forecast';

interface Deal {
  id: string;
  title: string;
  amount: string | number | null;
  close_date?: string;
  closeDate?: string;
  stage_name?: string;
  stageName?: string;
  stage?: string;
}

interface MonthlyForecast {
  month: string;
  total: number;
  weighted: number;
  count: number;
}

export default function ForecastPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
  let _ignore = false;
    fetch('/api/tenant/deals?limit=500')
      .then(r => r.json())
      .then(res => { setDeals(res.data || []); setLoading(false); })
      .catch(() => setLoading(false));
    return () => { _ignore = true; };
}, []);

  const now = new Date();
  const next6Months: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    next6Months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const monthlyData: MonthlyForecast[] = next6Months.map(ym => {
    const matching = deals.filter(d => {
      const cd = d.close_date || d.closeDate;
      if (!cd) return false;
      return cd.slice(0, 7) === ym;
    });
    const total = matching.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0);
    const weighted = matching.reduce((s, d) => {
      const amt = parseFloat(String(d.amount || 0));
      const stage = d.stage_name || d.stageName || d.stage || '';
      return s + calculateWeightedValue(amt, stage);
    }, 0);
    return { month: ym, total, weighted, count: matching.length };
  });

  const totalPipeline = deals.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0);
  const weightedForecast = deals.reduce((s, d) => {
    const stage = d.stage_name || d.stageName || d.stage || '';
    return s + calculateWeightedValue(parseFloat(String(d.amount || 0)), stage);
  }, 0);
  const dealCount = deals.length;
  const avgDealSize = dealCount > 0 ? totalPipeline / dealCount : 0;

  // Top 10 deals by weighted value
  const topDeals = [...deals]
    .map(d => ({
      ...d,
      weightedValue: calculateWeightedValue(parseFloat(String(d.amount || 0)), d.stage_name || d.stageName || d.stage || ''),
      probability: getStageProbability(d.stage_name || d.stageName || d.stage || ''),
    }))
    .sort((a, b) => b.weightedValue - a.weightedValue)
    .slice(0, 10);

  const chartData = monthlyData.map(d => ({
    name: new Date(d.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    pipeline: Math.round(d.total),
    weighted: Math.round(d.weighted),
  }));

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="admin-card p-4 rounded-xl"><div className="h-4 w-20 bg-muted rounded mb-2" /><div className="h-7 w-28 bg-muted rounded" /></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5" />Revenue Forecast</h1>
        <p className="text-sm text-muted-foreground">Weighted pipeline projections based on deal stages</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Pipeline', value: formatCurrency(totalPipeline), icon: DollarSign, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/20' },
          { label: 'Weighted Forecast', value: formatCurrency(weightedForecast), icon: Target, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/20' },
          { label: 'Deal Count', value: String(dealCount), icon: BarChart3, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/20' },
          { label: 'Avg Deal Size', value: formatCurrency(avgDealSize), icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/20' },
        ].map(s => (
          <div key={s.label} className="admin-card p-4 rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-1">
              <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', s.bg)}>
                <s.icon className={cn('w-3.5 h-3.5', s.color)} />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{s.label}</span>
            </div>
            <p className="text-lg font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="admin-card p-6 rounded-xl border border-border">
        <h2 className="font-semibold text-sm mb-4">Monthly Projections (Next 6 Months)</h2>
        {chartData.some(d => d.pipeline > 0 || d.weighted > 0) ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(val: number) => formatCurrency(val)} />
              <Bar dataKey="pipeline" fill="#8b5cf6" name="Pipeline" radius={[4, 4, 0, 0]} opacity={0.3} />
              <Bar dataKey="weighted" fill="#8b5cf6" name="Weighted" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
            No deals with close dates in the next 6 months
          </div>
        )}
      </div>

      {/* Top deals table */}
      <div className="admin-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">Top 10 Deals by Weighted Value</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Deal</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Stage</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Amount</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Probability</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Weighted</th>
            </tr>
          </thead>
          <tbody>
            {topDeals.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No deals found</td></tr>
            ) : topDeals.map(d => (
              <tr key={d.id} className="border-b border-border hover:bg-accent/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{d.title}</td>
                <td className="px-4 py-2.5 text-muted-foreground capitalize">{(d.stage_name || d.stageName || d.stage || 'Unknown stage').replace(/_/g, ' ')}</td>
                <td className="px-4 py-2.5 text-right">{formatCurrency(parseFloat(String(d.amount || 0)))}</td>
                <td className="px-4 py-2.5 text-right">{Math.round(d.probability * 100)}%</td>
                <td className="px-4 py-2.5 text-right font-semibold text-violet-600">{formatCurrency(d.weightedValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
