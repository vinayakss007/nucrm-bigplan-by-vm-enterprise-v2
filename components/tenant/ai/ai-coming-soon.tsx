'use client';
import Link from 'next/link';
import { CheckCircle2, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared "feature framing" page for AI capabilities that are wired but
 * not yet activated. Shows what the capability does, what it needs from
 * other CRM features, and a clear next step.
 *
 * Replaces the previous one-off scattered "Coming soon" stubs with a single
 * consistent feel — the user always knows it's the same product, just pieces
 * of it light up as deps get configured.
 */
type Dep = { label: string; href: string; ready: boolean };

export default function AIComingSoon({
  icon: Icon,
  title,
  blurb,
  capabilities,
  depends_on,
  cta,
}: {
  icon: any;
  title: string;
  blurb: string;
  capabilities: string[];
  depends_on: Dep[];
  cta: { label: string; href: string };
}) {
  const ready = depends_on.every(d => d.ready);

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{title}</h1>
            {!ready && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                Setup required
              </span>
            )}
            {ready && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                Ready
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{blurb}</p>
        </div>
      </div>

      {/* XL: 2-col layout for capabilities + deps */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">What it can do</p>
          <ul className="space-y-2">
            {capabilities.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Sparkles className="w-3.5 h-3.5 text-violet-600 shrink-0 mt-0.5" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Needs</p>
          <ul className="space-y-1.5">
            {depends_on.map(d => (
              <li key={d.href}>
                <Link href={d.href} className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-accent transition-colors',
                  d.ready ? 'text-foreground' : 'text-amber-700 dark:text-amber-400 font-medium',
                )}>
                  {d.ready
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    : <AlertCircle  className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                  <span className="flex-1 truncate">{d.label}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* CTA */}
      <div className="flex items-center justify-between flex-wrap gap-3 rounded-xl border border-violet-300/50 dark:border-violet-800/40 bg-violet-50/40 dark:bg-violet-950/20 p-4">
        <p className="text-sm">
          <span className="font-semibold">{ready ? 'Ready to use.' : 'Almost there.'}</span>{' '}
          <span className="text-muted-foreground">
            {ready ? 'Open the configuration to fine-tune behaviour.' : 'Set up the dependencies above and this lights up automatically.'}
          </span>
        </p>
        <Link href={cta.href}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
          {cta.label} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
