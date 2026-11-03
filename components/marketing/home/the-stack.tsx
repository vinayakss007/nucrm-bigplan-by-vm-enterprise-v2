/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { CheckList, Chip, Container, IconTile, Section, SectionHeading } from '@/components/marketing/ui';
import { REPLACES, UNIFIED_CHIPS, UNIFIED_POINTS } from '@/lib/marketing/home';

/**
 * #why — the before/after panel. The left half is the tool sprawl a team is
 * paying for; the right half is what one workspace replaces it with.
 */
export function HomeStack() {
  return (
    <Section id="why" tone="soft">
      <Container>
        <SectionHeading
          eyebrow="Why teams move"
          title={
            <>
              You are paying for twelve tools that
              <br className="hidden sm:block" /> all disagree about the customer
            </>
          }
          sub="Every extra tool is another login, another permission model, another copy of the truth — and another integration that breaks quietly on a Friday."
        />

        <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
          {/* before */}
          <Reveal className="mk-card p-6">
            <div className="mb-5 flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04]">
                <Icon name="Boxes" className="h-4 w-4 text-slate-500" />
              </span>
              <div>
                <div className="mk-h4 text-slate-300">Today</div>
                <div className="mk-tiny">Twelve subscriptions, twelve sources of truth</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {REPLACES.map((r) => (
                <span
                  key={r.tool}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 text-[12.5px] text-slate-500 line-through decoration-rose-500/40"
                >
                  <Icon name={r.icon} className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{r.tool}</span>
                </span>
              ))}
            </div>
            <p className="mk-small mt-5">
              Plus the glue: exports, spreadsheets, a shared mailbox and someone whose real job has become copying
              fields between systems.
            </p>
          </Reveal>

          {/* arrow */}
          <div className="flex items-center justify-center lg:px-2">
            <span className="flex h-11 w-11 rotate-90 items-center justify-center rounded-full border border-sky-400/30 bg-sky-500/12 text-sky-300 lg:rotate-0">
              <Icon name="ArrowRight" className="h-5 w-5" strokeWidth={2.2} />
            </span>
          </div>

          {/* after */}
          <Reveal delay={120} className="mk-card mk-edge relative overflow-hidden p-6">
            <div
              className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-sky-500/22 blur-3xl"
              aria-hidden
            />
            <div className="relative">
              <div className="mb-5 flex items-center gap-2.5">
                <IconTile name="Layers" />
                <div>
                  <div className="mk-h4 text-white">With NuCRM</div>
                  <div className="mk-tiny">One record, one permission model, one bill</div>
                </div>
              </div>
              <CheckList items={UNIFIED_POINTS} />
              <div className="mt-6 flex flex-wrap gap-2">
                {UNIFIED_CHIPS.map((c) => (
                  <Chip key={c.label} icon={c.icon}>{c.label}</Chip>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
