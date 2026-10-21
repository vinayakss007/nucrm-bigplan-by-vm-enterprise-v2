/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { DollarSign, Loader2, Check, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import InlineErrorState from '@/components/shared/inline-error-state';

interface CurrencyData {
  currencies: CurrencyInfo[];
  /** Currency the rates are expressed against — the API always uses USD. */
  baseCurrency: string;
  /** The tenant's own default, persisted in tenants.settings. */
  defaultCurrency?: string;
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

const CURRENCY_QUERY = ['tenant', 'currency'] as const;
const EMPTY_CURRENCY: CurrencyData = { currencies: [], baseCurrency: 'USD', defaultCurrency: 'USD', rates: {} };

export default function CurrencySettingsPage() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  // #1328: TanStack Query. `select` applies the default-currencies fallback so
  // the component always sees a populated list. `error` and `refetch` are bound
  // now that the page branches on which read the failure belongs to (#2872).
  const { data, isLoading: loading, error: currencyError, refetch } = useApiQuery<{ data?: CurrencyData }>(
    CURRENCY_QUERY,
    '/api/tenant/currency',
    {
      select: (raw) => {
        const fetched = raw?.data ?? EMPTY_CURRENCY;
        return {
          data: {
            ...fetched,
            currencies: fetched.currencies?.length ? fetched.currencies : DEFAULT_CURRENCIES,
          },
        };
      },
    },
  );
  const currencyData: CurrencyData = data?.data ?? EMPTY_CURRENCY;

  // #2872: `currencyError` alone cannot tell "this read never answered" from
  // "this read answered and the refresh was refused", and TanStack Query keeps
  // `data` straight through the second (`lib/query/client.tsx:46-58`: `retry: 2`,
  // `staleTime: 30_000`, `refetchOnWindowFocus: false`). The old page bound no
  // `error` at all, so both states fell into the `loading ? … : values` arm.
  // The trap specific to THIS page is that arm's inputs: `select` substitutes
  // DEFAULT_CURRENCIES and `currencyData` substitutes EMPTY_CURRENCY, so a never-answered read
  // arrives dressed as a populated ten-currency picker with "Default: USD" beside it. TanStack
  // runs `select` only on a payload that exists, so `data` itself is still `undefined` when the
  // read never answered — which is why both flags test `data` and not `currencyData`.
  // `failed` is a read that never answered; `stale` is the last read, still held.
  const failed = Boolean(currencyError) && !data;
  const stale = Boolean(currencyError) && Boolean(data);
  // The transport message (`ApiQueryError.message`, `lib/query/client.tsx:41`) is interpolated
  // as-is into BOTH banners, per the epic's house convention, with the messageless fallback
  // spelled out so a refusal with no message never prints `undefined`.
  const reason = currencyError?.message || 'no response from the server';

  // Whether the read answered at all. During the first load `data` is undefined,
  // exactly as over a failed read, so nothing derived from the read may be shown
  // as a value yet — it is withheld instead of defaulting. `data`, never
  // `currencyData`: the latter is `?? EMPTY_CURRENCY` and so always truthy.
  const hasRead = Boolean(data);
  const readDefault = currencyData.defaultCurrency ?? 'USD';
  // The tenant's choice, not the rate basis. baseCurrency is always USD, and
  // comparing the highlight against it made the picker jump back to USD on every
  // revalidation, so a saved default looked like it had not taken (#1328). With no
  // read there is no default to highlight and none to state, so both are withheld.
  const activeDefault = hasRead ? readDefault : '';
  const defaultDisplay = hasRead ? readDefault : '\u2014';

  const setDefault = async (code: string) => {
    // Epic rule #1: a read that never answered must not drive a tenant-wide write. Over
    // `failed` the picker is the built-in list rather than the tenant's, so the whole grid is
    // unmounted above; this is the second lock for any call path that reaches the handler anyway.
    // Over `stale` the save stays live — see the banner's route audit.
    if (failed) return;
    if (code === activeDefault) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/currency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: code }),
      });
      if (res.ok) {
        // Optimistically update the cached default, then revalidate.
        queryClient.setQueryData<{ data?: CurrencyData }>(CURRENCY_QUERY, (prev) =>
          prev?.data ? { data: { ...prev.data, defaultCurrency: code } } : prev,
        );
        queryClient.invalidateQueries({ queryKey: CURRENCY_QUERY });
        toast.success(`Default currency set to ${code}`);
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to update currency');
      }
    } finally {
      setSaving(false);
    }
  };

  const currencies = currencyData.currencies.length > 0 ? currencyData.currencies : DEFAULT_CURRENCIES;
  const rateCount = Object.keys(currencyData.rates).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Currency Settings</h1>
          <p className="text-sm text-muted-foreground">Manage supported currencies and exchange rates</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
          <DollarSign className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">Default: {defaultDisplay}</span>
        </div>
      </div>

      {stale && (
        // The one write this page makes is `setDefault` → POST (app/api/tenant/currency/route.ts:84).
        // Measured against the route, which is what decides that it stays live over `stale`:
        //  - it validates the code against the server's own `SUPPORTED_CURRENCIES` allowlist and
        //    answers 400 for anything else (route.ts:94-101), so a stale pick is still checked;
        //  - it writes ONE key with `jsonb_set` over `COALESCE(settings,'{}')` (route.ts:106-116),
        //    so it cannot clobber the other settings keys, and the list and rates are never stored
        //    at all — GET recomputes them from `getSupportedCurrencies()` and the rate provider
        //    (route.ts:47-62).
        // What it does NOT do is read the stored default back or compare against an expected value:
        // the last write wins, and the only precondition is that the tenant row still exists
        // (route.ts:118). So the save stays enabled and the banner names that overwrite as the cost.
        <InlineErrorState
          message={`Could not refresh the currency settings, so the supported list, the highlighted default and the exchange rates are the last read: ${reason}. Setting a default now replaces the tenant's current one without this page having read it, and a rate that moved since this was read is still shown as current.`}
          onRetry={() => void refetch()}
        />
      )}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : failed ? (
        // #2872: the outage arm owns this whole region. `select` falls back to DEFAULT_CURRENCIES
        // and `currencyData` to EMPTY_CURRENCY, so a read that never answered arrives here looking
        // like a populated ten-currency picker with "Default: USD" beside it. Nothing derived from
        // the read may be asserted, so the grid, the rates and every `Set as default` button are
        // withheld rather than rendered disabled above an answer that was never given — and the
        // header shows the dash, which is why the copy says the dash is not USD.
        <InlineErrorState
          message={`Failed to load the currency settings: ${reason}. The supported currency list, the tenant's default and the exchange rates are unanswered — the picker is withheld, not empty, and the dash above is not this tenant's default.`}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          {/* Currency Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {currencies.map(c => {
              const isDefault = c.code === activeDefault;
              const rate = currencyData.rates[c.code];
              return (
                <div key={c.code} className={cn(
                  'admin-card p-4 relative transition-all',
                  isDefault && 'ring-2 ring-violet-500 dark:ring-violet-400'
                )}>
                  {isDefault && (
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
                  {/* A rate is only ever derived from the read: this branch needs the read to have
                      answered, and a currency with no rate shows no conversion line rather than one
                      rendered as a zero (rule #5). */}
                  {rate !== undefined && !isDefault && (
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <ArrowRightLeft className="w-3 h-3" />
                      1 {currencyData.baseCurrency} = {rate} {c.code}
                    </p>
                  )}
                  {!isDefault && (
                    <button
                      onClick={() => setDefault(c.code)}
                      disabled={saving || failed}
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

          {/* The cost stated in the banner repeated where the click happens, since this is the
              only control on the page and it is deliberately left live over a last read. It says
              nothing when the read is neither stale nor failed. */}
          {stale && (
            <p className="text-xs text-muted-foreground">
              Set as default writes the code you click over the stored default, and nothing is
              read back first.
            </p>
          )}

          {/* Exchange Rates Table */}
          {rateCount > 0 && (
            <div className="admin-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-sm">Exchange Rates</h3>
                <p className="text-xs text-muted-foreground">Relative to {currencyData.baseCurrency}</p>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[400px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Currency</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(currencyData.rates).map(([code, rate]) => (
                    <tr key={code} className="border-b border-border last:border-0 hover:bg-accent/50">
                      <td className="px-4 py-3 font-medium">{code}</td>
                      <td className="px-4 py-3 text-muted-foreground">{rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* #2872: an empty exchange-rate set is a fact about a read that answered — GET returns
              `rates: {}` when the upstream provider throws (app/api/tenant/currency/route.ts:51-62)
              while still answering 200. This branch is only reachable on a read that answered, so
              the absence can be stated; over `failed` the whole region above is withheld instead,
              because there `rateCount` is 0 only because nothing was read. */}
          {rateCount === 0 && (
            <p className="text-xs text-muted-foreground">
              No exchange rates came back with this list, so the cards above show no conversion.
            </p>
          )}
        </>
      )}
    </div>
  );
}
