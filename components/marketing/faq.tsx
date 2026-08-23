/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState } from 'react';
import { Icon } from './icon';

/**
 * Disclosure list. Deliberately not a Radix accordion: this needs to be a
 * single small client island on otherwise static pages, and the interaction is
 * one boolean per row.
 */
export function Faq({ items }: { items: readonly { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto max-w-3xl divide-y divide-white/[0.07] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <h3>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-5 px-5 py-5 text-left transition-colors hover:bg-white/[0.025] sm:px-7"
              >
                <span className="mk-h4 text-white">{item.q}</span>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
                    isOpen ? 'rotate-180 border-violet-400/40 bg-violet-500/15 text-violet-300' : 'border-white/10 text-slate-500'
                  }`}
                >
                  <Icon name="ChevronDown" className="h-4 w-4" strokeWidth={2.2} />
                </span>
              </button>
            </h3>
            <div
              className="grid transition-all duration-400 ease-out"
              style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <p className="mk-body px-5 pb-6 pr-14 sm:px-7">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
