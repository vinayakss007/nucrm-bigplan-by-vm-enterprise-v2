'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles, BrainCircuit, FileEdit, Target, AlertTriangle, Activity,
  ArrowRight, Loader2, MessageSquare, CheckCircle2, AlertCircle, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AI_CAPABILITIES, AI_PROVIDER_PRESETS, getProviderLabel } from '@/components/tenant/ai/ai-config';
import { usePlanFeatures } from '@/hooks/use-plan-features';

const _PRESETS = AI_PROVIDER_PRESETS ?? {};
const _CAPABILITIES = AI_CAPABILITIES ?? [];

/**
 * AI Hub landing — the single place every AI capability lives.
 * Replaces the previous "scattered AI things" UX.
 */
type Status = {
  providers: { id: string; enabled: boolean; status: 'ready' | 'missing_key' | 'error' }[];
  enabled_count: number;
  draft_count_today: number;
  scoring_runs_today: number;
  at_risk_count: number;
  tokens_today: number;
};

export default function AIHubPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const { hasFeature, loaded: featuresLoaded } = usePlanFeatures();

  useEffect(() => {
    fetch('/api/tenant/ai/status')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const providersUp = status?.enabled_count ?? 0;
  const totalProviders = status?.providers?.length ?? Object.keys(_PRESETS).length;

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      {/* Hero */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" /> AI Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Every AI capability in one place. Drafts, scoring, risk detection, summaries — all powered by the same multi-provider gateway. You can edit any AI output before it ships.
          </p>
        </div>

        {!loading && (
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium',
            providersUp > 0
              ? 'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-amber-300/60  bg-amber-50  text-amber-700  dark:bg-amber-950/30  dark:text-amber-300',
          )}>
            {providersUp > 0 ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {providersUp} / {totalProviders} provider{providersUp === 1 ? '' : 's'} configured
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
        <Stat icon={FileEdit}      label="Drafts today"     value={status?.draft_count_today ?? 0} />
        <Stat icon={Target}        label="Scoring runs"     value={status?.scoring_runs_today ?? 0} />
        <Stat icon={AlertTriangle} label="At-risk deals"    value={status?.at_risk_count ?? 0} accent={(status?.at_risk_count ?? 0) > 0 ? 'amber' : undefined} />
        <Stat icon={Activity}      label="Tokens today"     value={(status?.tokens_today ?? 0).toLocaleString()} />
        <Stat icon={BrainCircuit}  label="Providers"        value={`${providersUp}/${totalProviders}`} />
        <Stat icon={Sparkles}      label="Time saved"       value="—" sub="coming soon" />
      </div>

      {/* Quick actions */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">Quick actions</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          <ActionCard
            href="/tenant/ai/draft"
            icon={FileEdit}
            title="Draft a follow-up"
            desc="Pick a contact or deal, AI writes the next email."
            tone="violet"
          />
          <ActionCard
            href="/tenant/ai/lead-scoring"
            icon={Target}
            title="Score leads now"
            desc="Re-rank your lead queue using current activity."
            tone="blue"
          />
          <ActionCard
            href="/tenant/ai/at-risk"
            icon={AlertTriangle}
            title="Find at-risk deals"
            desc="Spot stalled pipeline before quarter-end."
            tone="amber"
          />
          <ActionCard
            href="/tenant/ai/summarize"
            icon={MessageSquare}
            title="Summarize a record"
            desc="TL;DR of any contact, company or deal."
            tone="emerald"
          />
        </div>
      </div>

      {/* Capabilities grid */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">All capabilities</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {_CAPABILITIES.filter(c => c.href !== '/tenant/ai').map(cap => {
            const Icon = cap.icon;
            const enabled = !cap.featureKey || !featuresLoaded || hasFeature(cap.featureKey);
            return (
              <Link key={cap.href} href={enabled ? cap.href : '#'}
                className={cn(
                  'group flex items-start gap-3 px-4 py-3 rounded-xl border bg-card transition-all hover:-translate-y-px',
                  enabled
                    ? 'border-border hover:border-violet-300 dark:hover:border-violet-800 hover:bg-violet-50/30 dark:hover:bg-violet-950/10'
                    : 'border-border/50 opacity-60 cursor-not-allowed hover:translate-y-0',
                )}>
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                  enabled ? 'bg-muted/50 group-hover:bg-violet-100 dark:group-hover:bg-violet-950/40' : 'bg-muted/30',
                )}>
                  <Icon className={cn('w-4 h-4 transition-colors', enabled ? 'text-muted-foreground group-hover:text-violet-600 dark:group-hover:text-violet-400' : 'text-muted-foreground/50')} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold truncate">{cap.label}</p>
                    {cap.badge === 'beta' && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500 text-white font-bold uppercase tracking-wider">Beta</span>
                    )}
                    {cap.badge === 'soon' && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-slate-500 text-white font-bold uppercase tracking-wider">Soon</span>
                    )}
                    {!enabled && (
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-violet-500 text-white font-bold uppercase tracking-wider flex items-center gap-0.5">
                        <Lock className="w-2 h-2" /> Upgrade
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{cap.desc}</p>
                  {cap.depends_on.length > 0 && (
                    <p className="text-[10px] text-muted-foreground/70 mt-1.5 truncate">
                      <span className="font-semibold">Needs:</span> {cap.depends_on.join(' · ')}
                    </p>
                  )}
                </div>
                {enabled && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-violet-600 dark:group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />}
                {!enabled && <Lock className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0 mt-0.5" />}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Provider status row */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-muted-foreground" /> Provider status
          </p>
          <Link href="/tenant/settings/ai-providers" className="text-xs text-violet-600 hover:underline flex items-center gap-1">
            Manage <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {(status?.providers ?? []).map(p => {
            const ready = p.enabled && p.status === 'ready';
            const preset = _PRESETS[p.id];
            return (
              <div key={p.id} className={cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-lg border',
                ready ? 'border-emerald-300/60 bg-emerald-50/30 dark:bg-emerald-950/10' : 'border-border',
              )}>
                <div className={cn('w-1.5 h-1.5 rounded-full',
                  ready ? 'bg-emerald-500' : p.enabled ? 'bg-amber-500' : 'bg-muted-foreground/30',
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{getProviderLabel(p.id)}</p>
                  <p className="text-[10px] text-muted-foreground truncate font-mono">{preset?.defaultModel ?? 'custom'}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Stat({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: number | string; sub?: string; accent?: 'amber' }) {
  return (
    <div className={cn(
      'rounded-xl border-2 p-3 shadow-sm hover:shadow-md transition-shadow',
      accent === 'amber' ? 'border-amber-300/80 bg-amber-50/40 dark:bg-amber-950/20' : 'border-border/80 bg-card',
    )}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        <Icon className="w-3 h-3" /> <span className="truncate">{label}</span>
      </div>
      <p className="text-3xl font-black tabular-nums mt-1 text-black dark:text-white">{value}</p>
      {sub && <p className="text-[10px] font-medium text-muted-foreground/60 mt-0.5">{sub}</p>}
    </div>
  );
}

function ActionCard({ href, icon: Icon, title, desc, tone }: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  href: string; icon: any; title: string; desc: string; tone: 'violet' | 'blue' | 'amber' | 'emerald';
}) {
  const tones = {
    violet:  { ring: 'hover:border-violet-400 dark:hover:border-violet-600',   bg: 'bg-violet-100/60 dark:bg-violet-950/30',  ic: 'text-violet-600 dark:text-violet-400' },
    blue:    { ring: 'hover:border-blue-400   dark:hover:border-blue-600',     bg: 'bg-blue-100/60   dark:bg-blue-950/30',    ic: 'text-blue-600   dark:text-blue-400' },
    amber:   { ring: 'hover:border-amber-400  dark:hover:border-amber-600',    bg: 'bg-amber-100/60  dark:bg-amber-950/30',   ic: 'text-amber-600  dark:text-amber-400' },
    emerald: { ring: 'hover:border-emerald-400 dark:hover:border-emerald-600', bg: 'bg-emerald-100/60 dark:bg-emerald-950/30', ic: 'text-emerald-600 dark:text-emerald-400' },
  };
  const t = tones[tone];
  return (
    <Link href={href} className={cn(
      'group flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-card transition-all hover:shadow-sm hover:-translate-y-px',
      t.ring,
    )}>
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', t.bg)}>
        <Icon className={cn('w-4 h-4', t.ic)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{desc}</p>
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
    </Link>
  );
}
