'use client';
import { useState, useEffect } from 'react';
import { DollarSign, Loader2, Check, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface CurrencyData {
  currencies: CurrencyInfo[];
  baseCurrency: string;
  rates: Record<string, number>;
}

interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
}

const DEFAULT_CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '\u20AC' },
  { code: 'GBP', name: 'British Pound', symbol: '\u00A3' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '\u00A5' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'INR', name: 'Indian Rupee', symbol: '\u20B9' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '\u00A5' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
];

export default function CurrencySettingsPage() {
  const [data, setData] = useState<CurrencyData>({ currencies: [], baseCurrency: 'USD', rates: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/currency');
      if (res.ok) {
        const d = await res.json();
        const fetched = d.data ?? { currencies: [], baseCurrency: 'USD', rates: {} };
        if (!fetched.currencies || fetched.currencies.length === 0) {
          fetched.currencies = DEFAULT_CURRENCIES;
        }
        setData(fetched);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setDefault = async (code: string) => {
    if (code === data.baseCurrency) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/currency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: code }),
      });
      if (res.ok) {
        setData(prev => ({ ...prev, baseCurrency: code }));
        toast.success(`Default currency set to ${code}`);
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to update currency');
      }
    } finally {
      setSaving(false);
    }
  };

  const currencies = data.currencies.length > 0 ? data.currencies : DEFAULT_CURRENCIES;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Currency Settings</h1>
          <p className="text-sm text-muted-foreground">Manage supported currencies and exchange rates</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
          <DollarSign className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">Base: {data.baseCurrency}</span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Currency Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {currencies.map(c => {
              const isBase = c.code === data.baseCurrency;
              const rate = data.rates[c.code];
              return (
                <div key={c.code} className={cn(
                  'admin-card p-4 relative transition-all',
                  isBase && 'ring-2 ring-violet-500 dark:ring-violet-400'
                )}>
                  {isBase && (
                    <span className="absolute top-2 right-2 text-xs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
                      Default
                    </span>
                  )}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg font-bold">
                      {c.symbol}
                    </div>
                    <div>
                      <p className="font-semibold">{c.code}</p>
                      <p className="text-xs text-muted-foreground">{c.name}</p>
                    </div>
                  </div>
                  {rate !== undefined && !isBase && (
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <ArrowRightLeft className="w-3 h-3" />
                      1 {data.baseCurrency} = {rate} {c.code}
                    </p>
                  )}
                  {!isBase && (
                    <button
                      onClick={() => setDefault(c.code)}
                      disabled={saving}
                      className="mt-3 flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Set as default
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Exchange Rates Table */}
          {Object.keys(data.rates).length > 0 && (
            <div className="admin-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-sm">Exchange Rates</h3>
                <p className="text-xs text-muted-foreground">Relative to {data.baseCurrency}</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Currency</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.rates).map(([code, rate]) => (
                    <tr key={code} className="border-b border-border last:border-0 hover:bg-accent/50">
                      <td className="px-4 py-3 font-medium">{code}</td>
                      <td className="px-4 py-3 text-muted-foreground">{rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
