/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Icon } from './icon';
import { softLower } from '@/lib/marketing/text';

/** Which product mock to show — resolved client-side by TourVisual (#1972). */
export type MockKey = 'ai' | 'automation' | 'conversations' | 'revenue' | 'analytics';

const TourVisual = dynamic(() => import('./tour-visual'), {
  ssr: false,
  loading: () => (
    <div
      className="min-h-[380px] w-full rounded-2xl border border-white/[0.09] bg-[#0a1330]/60 animate-pulse"
      aria-hidden
    />
  ),
});

export type TourTab = {
  id: string;
  label: string;
  icon: string;
  accent: string;
  title: string;
  body: string;
  points: string[];
  href: string;
  visual: MockKey;
};

/**
 * Tabbed walkthrough of the product. The tab copy is server-rendered, but the
 * mock visuals are resolved from a string key inside a `ssr: false` island
 * (#1972): previously the landing page built the mock JSX server-side and
 * handed it over as props, so the full DOM of five dashboard mocks was
 * serialized into the RSC flight *and* SSR'd into the HTML — a large slice of
 * the 570 KB payload for content below the fold.
 */
export function ProductTour({ tabs }: { tabs: TourTab[] }) {
  const [active, setActive] = useState(0);
  const current = tabs[active];

  return (
    <div>
      {/* tab rail */}
      <div
        role="tablist"
        aria-label="Product walkthrough"
        className="mk-fade-x -mx-5 mb-8 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:justify-center sm:overflow-visible sm:px-0"
      >
        {tabs.map((t, i) => {
          const on = i === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              aria-controls={`tour-panel-${t.id}`}
              onClick={() => setActive(i)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13.5px] font-semibold transition-all duration-300 ${
                on
                  ? 'border-sky-400/35 bg-sky-500/15 text-white shadow-[0_8px_30px_-12px_rgba(37,99,235,0.9)]'
                  : 'border-white/[0.08] bg-white/[0.025] text-slate-400 hover:border-white/20 hover:text-slate-200'
              }`}
            >
              <Icon name={t.icon} className={`h-4 w-4 ${on ? 'text-sky-300' : 'text-slate-500'}`} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* panel */}
      {current && (
        <div
          id={`tour-panel-${current.id}`}
          role="tabpanel"
          className="grid animate-fade-in items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
          key={current.id}
        >
          <div>
            <span
              className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${current.accent} shadow-lg shadow-black/40 ring-1 ring-inset ring-white/20`}
            >
              <Icon name={current.icon} className="h-5 w-5 text-white" strokeWidth={1.8} />
            </span>
            <h3 className="mk-h3 text-white">{current.title}</h3>
            <p className="mk-body mt-3">{current.body}</p>
            <ul className="mt-5 space-y-2.5">
              {current.points.map((p) => (
                <li key={p} className="flex gap-3">
                  <Icon name="Check" className="mt-[3px] h-4 w-4 shrink-0 text-sky-400" strokeWidth={2.4} />
                  <span className="mk-body text-slate-300">{p}</span>
                </li>
              ))}
            </ul>
            <Link href={current.href} className="mk-link group mt-6 inline-flex items-center gap-1.5 text-sm">
              Go deeper on {softLower(current.label)}
              <Icon
                name="ArrowUpRight"
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                strokeWidth={2.2}
              />
            </Link>
          </div>

          <div className="relative">
            <div
              className={`pointer-events-none absolute -inset-6 -z-10 rounded-[32px] bg-gradient-to-br ${current.accent} opacity-[0.18] blur-3xl`}
              aria-hidden
            />
            <TourVisual name={current.visual} />
          </div>
        </div>
      )}
    </div>
  );
}
