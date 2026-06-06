'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, ChevronRight, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AI_CAPABILITIES } from '@/components/tenant/ai/ai-config';
import { useEffect, useState } from 'react';
import { logError } from '@/lib/errors';

/**
 * AI Hub shell — sub-rail on lg+, horizontal scroll pills below lg.
 * Same layout pattern as Settings so the app feels consistent.
 */
export default function AILayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch('/api/tenant/me')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setIsAdmin(d.is_admin ?? false))
      .catch((err) => logError(err, "async-catch:[context]"));
  }, []);

  const items = AI_CAPABILITIES.filter(c => !c.adminOnly || isAdmin);

  const isActive = (href: string) => {
    if (href === '/tenant/ai') return pathname === '/tenant/ai';
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:gap-6 -m-4 sm:-m-6 p-4 sm:p-6 min-h-[calc(100vh-3.5rem)]">
      {/* Mobile/tablet: horizontal scroll pills */}
      <nav className="lg:hidden -mx-1 px-1 overflow-x-auto scrollbar-thin">
        <div className="flex gap-1.5 pb-2 min-w-max">
          {items.map(item => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors shrink-0',
                  active
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                )}>
                <Icon className="w-3.5 h-3.5" />
                {item.label}
                {item.badge === 'beta' && (
                  <span className="text-[8px] px-1 rounded bg-amber-500 text-white font-bold uppercase">Beta</span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop: side-rail */}
      <aside className="hidden lg:block w-60 shrink-0 lg:sticky lg:top-0 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto scrollbar-thin">
        <div className="lg:pr-3 lg:py-2 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-violet-600" /> AI Hub
            </h2>
            <Link href="/tenant/dashboard" className="text-[10px] text-muted-foreground hover:text-foreground">
              ← Back
            </Link>
          </div>
          <div className="space-y-0.5">
            {items.map(item => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={cn(
                    'group flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors',
                    active
                      ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  )}>
                  <Icon className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', active && 'text-violet-600 dark:text-violet-400')} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{item.label}</span>
                      {item.badge === 'beta' && (
                        <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500 text-white font-bold uppercase tracking-wider">Beta</span>
                      )}
                      {item.adminOnly && (
                        <ShieldCheck className="w-2.5 h-2.5 text-amber-500" />
                      )}
                    </div>
                    {item.desc && (
                      <p className={cn(
                        'text-[10px] mt-0.5 truncate',
                        active ? 'text-violet-600/70 dark:text-violet-400/70' : 'text-muted-foreground/70',
                      )}>{item.desc}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 lg:border-l lg:border-border lg:pl-6">
        <div className="max-w-[1600px]">
          {children}
        </div>
      </div>
    </div>
  );
}
