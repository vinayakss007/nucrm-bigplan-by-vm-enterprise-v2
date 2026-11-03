/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { Icon } from '@/components/marketing/icon';
import { Container, Marquee } from '@/components/marketing/ui';
import { MODULES } from '@/lib/marketing/modules';
import { MODULE_TINT } from '@/lib/marketing/tints';

/** The scrolling rail of module names under the hero. */
export function HomeModuleMarquee() {
  return (
    <div className="relative pb-4 pt-6">
      <Container>
        <p className="mk-tiny mb-5 text-center uppercase tracking-[0.16em]">
          {MODULES.length} modules · switch on what you need
        </p>
      </Container>
      <Marquee>
        {MODULES.map((m) => (
          <span
            key={m.id}
            className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5"
          >
            <span className="flex shrink-0" style={{ color: MODULE_TINT[m.category] ?? '#a94f32' }}>
              <Icon name={m.icon} className="h-4 w-4" />
            </span>
            <span className="whitespace-nowrap text-[13px] font-semibold text-slate-300">{m.name}</span>
          </span>
        ))}
      </Marquee>
    </div>
  );
}
