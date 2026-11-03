/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { Container, GhostCta, Section, SectionHeading } from '@/components/marketing/ui';
import { MODULES } from '@/lib/marketing/modules';
import { PLANS } from '@/lib/marketing/pricing';

/** #pricing — the four plan cards, with the featured one carrying the glow. */
export function HomePricing() {
  return (
    <Section id="pricing" tone="soft">
      <Container>
        <SectionHeading
          eyebrow="Pricing"
          title="Per user, plus the modules you switch on"
          sub="No contact bands, no marketing-tier maths, no negotiating for a feature you assumed was included. Start free and stay there as long as it works."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 70}>
              <div
                className={`relative flex h-full flex-col rounded-2xl border p-6 ${
                  plan.featured
                    ? 'mk-edge mk-glow border-sky-400/30 bg-gradient-to-b from-blue-600/[0.16] to-white/[0.02]'
                    : 'border-white/[0.08] bg-white/[0.025]'
                }`}
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-blue-500 to-sky-400 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-white shadow-lg shadow-blue-500/30">
                    Most teams
                  </span>
                )}
                <div className="mk-h4 text-white">{plan.name}</div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[34px] font-extrabold leading-none tracking-tight text-white">
                    {plan.price}
                  </span>
                  <span className="mk-tiny">{plan.period}</span>
                </div>
                <p className="mk-small mt-3 min-h-[54px]">{plan.pitch}</p>
                <Link
                  href={plan.cta.href}
                  className={`mk-btn mt-4 w-full ${plan.featured ? 'mk-btn-primary' : 'mk-btn-ghost'}`}
                >
                  {plan.cta.label}
                </Link>
                <ul className="mt-6 space-y-2 border-t border-white/[0.07] pt-5">
                  {plan.includes.slice(0, 6).map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <Icon
                        name="Check"
                        className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${plan.featured ? 'text-sky-300' : 'text-emerald-400'}`}
                        strokeWidth={2.6}
                      />
                      <span className="text-[13.5px] leading-relaxed text-slate-400">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <GhostCta href="/pricing">Full plan comparison</GhostCta>
          <GhostCta href="/modules">See all {MODULES.length} modules</GhostCta>
        </Reveal>
      </Container>
    </Section>
  );
}
