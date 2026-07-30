'use client';

import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Calendar, Target, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';

interface Forecast {
  id: string;
  expected_close_date: string | null;
  probability: number | null;
  forecast_amount: number | null;
  confidence_level: string | null;
  created_at: string;
  updated_at: string;
}

export default function DealForecast({ dealId }: { dealId: string }) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    expected_close_date: '',
    probability: '50',
    forecast_amount: '',
    confidence_level: 'medium',
  });

  const fetchForecast = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenant/deals/${dealId}/forecast`);
      if (!res.ok) return;
      const data = await res.json();
      const f = data.data;
      if (f) {
        setForecast(f);
        setForm({
          expected_close_date: f.expected_close_date ? (new Date(f.expected_close_date).toISOString().split('T')[0] ?? '') : '',
          probability: String(f.probability ?? 50),
          forecast_amount: String(f.forecast_amount ?? ''),
          confidence_level: f.confidence_level || 'medium',
        });
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { fetchForecast(); }, [fetchForecast]);

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/tenant/deals/${dealId}/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_close_date: form.expected_close_date || undefined,
          probability: Number(form.probability) || 50,
          forecast_amount: form.forecast_amount ? Number(form.forecast_amount) : undefined,
          confidence_level: form.confidence_level,
        }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed to save forecast'); return; }
      toast.success('Forecast updated');
      setEditing(false);
      fetchForecast();
    } catch {
      toast.error('Failed to save forecast');
    }
  };

  const confidenceColors: Record<string, string> = {
    low: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    high: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };

  if (loading) return <div className="animate-pulse space-y-3"><div className="h-6 bg-muted rounded w-40" /><div className="h-20 bg-muted rounded" /></div>;

  if (!forecast && !editing) {
    return (
      <div className="text-center py-6">
        <TrendingUp className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground mb-3">No forecast for this deal yet</p>
        <Button size="sm" onClick={() => setEditing(true)}>Create Forecast</Button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Edit Forecast</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Expected Close Date</label>
            <input type="date" className="w-full px-3 py-2 border rounded-lg bg-background text-sm" value={form.expected_close_date} onChange={e => setForm({ ...form, expected_close_date: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Probability (%)</label>
            <input type="number" min="0" max="100" className="w-full px-3 py-2 border rounded-lg bg-background text-sm" value={form.probability} onChange={e => setForm({ ...form, probability: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Forecast Amount ($)</label>
            <input type="number" min="0" className="w-full px-3 py-2 border rounded-lg bg-background text-sm" placeholder="e.g. 50000" value={form.forecast_amount} onChange={e => setForm({ ...form, forecast_amount: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Confidence</label>
            <select className="w-full px-3 py-2 border rounded-lg bg-background text-sm" value={form.confidence_level} onChange={e => setForm({ ...form, confidence_level: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave}>Save Forecast</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Forecast</h3>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Expected Close</p>
            <p className="text-sm font-medium">{forecast?.expected_close_date ? new Date(forecast.expected_close_date).toLocaleDateString() : 'Not set'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Probability</p>
            <p className="text-sm font-medium">{forecast?.probability ?? 0}%</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Forecast Amount</p>
            <p className="text-sm font-medium">{forecast?.forecast_amount ? `$${Number(forecast.forecast_amount).toLocaleString()}` : 'Not set'}</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Confidence</p>
          <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${confidenceColors[forecast?.confidence_level || 'medium']}`}>
            {forecast?.confidence_level || 'medium'}
          </span>
        </div>
      </div>
    </div>
  );
}
