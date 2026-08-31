/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDIO, STUDIO_PRODUCTS } from '@/lib/marketing/abetworks';
import { MODULES } from '@/lib/marketing/modules';
import { SOLUTIONS } from '@/lib/marketing/solutions';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { AbetworksWordmark, LogoMark } from '@/components/marketing/logo';
import {
  Container,
  CtaBand,
  GhostCta,
  IconTile,
  PageHero,
  Section,
  SectionHeading,
} from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'abetworks — the studio behind NuCRM',
  description:
    'abetworks is a product studio building business software that respects the people using it. NuCRM is our platform, and eight focused products are built on it.',
  alternates: { canonical: '/abetworks' },
};

export default function AbetworksPage() {
  return (
    <>
      <PageHero
        eyebrow="The studio"
        title={
          <>
            We are <AbetworksWordmark className="mk-grad-violet" />, and we build the
            <br className="hidden sm:block" /> software we wanted to be sold
          </>
        }
        sub={STUDIO.intro}
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'abetworks', href: '/abetworks' },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <GhostCta href="#products">See the product family</GhostCta>
          <GhostCta href="/contact">Get in touch</GhostCta>
        </div>
      </PageHero>

      {/* why we exist */}
      <Section className="!pt-6">
        <Container>
          <Reveal className="mk-card mk-edge relative overflow-hidden p-7 sm:p-10">
            <div
              className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-sky-500/20 blur-3xl"
              aria-hidden
            />
            <div className="relative grid gap-10 lg:grid-cols-[1fr_1.1fr]">
              <div>
                <div className="mk-eyebrow text-sky-300/90">Why we started</div>
                <h2 className="mk-h2 mt-3 text-white">{STUDIO.tagline}</h2>
              </div>
              <div className="space-y-4">
                <p className="mk-lead">
                  Business software has a strange failure mode. A company buys a platform that can do everything, spends
                  two quarters configuring it, trains everyone twice — and eighteen months later the real work is happening
                  in a spreadsheet again, because the software was never built for the person who has to use it every day.
                </p>
                <p className="mk-body">
                  We think the reason is simple. Most of this software is sold to the person signing the contract, not to
                  the person who will open it every morning. So it optimises for the demo and the feature comparison
                  rather than for a Tuesday afternoon with forty things to chase.
                </p>
                <p className="mk-body">
                  NuCRM is our answer: enterprise depth — permissions, audit, billing, compliance, multi-workspace — in a
                  product a five-person team can adopt in an afternoon and never outgrow. Everything else we build sits on
                  the same platform, so nothing we ship ever needs to be integrated with the rest of what we ship.
                </p>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* principles */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="How we work"
            title="Six commitments we hold ourselves to"
            sub="These are not values on a wall. Each one shows up as a decision in the product, and you can check us against them."
          />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STUDIO.principles.map((p, i) => (
              <Reveal key={p.title} delay={(i % 3) * 60} className="mk-card mk-card-hover flex h-full flex-col p-6">
                <IconTile name={p.icon} />
                <h3 className="mk-h4 mt-4 text-white">{p.title}</h3>
                <p className="mk-body mt-2 flex-1">{p.body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* the platform */}
      <Section>
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <div className="flex items-center gap-3">
                <LogoMark size={44} />
                <div>
                  <div className="mk-h3 text-white">NuCRM</div>
                  <div className="mk-tiny lowercase tracking-wider">the platform everything runs on</div>
                </div>
              </div>
              <p className="mk-lead mt-6">
                One platform, {MODULES.length} modules, {SOLUTIONS.length} industry blueprints and eight packaged products
                — all writing to the same customer record.
              </p>
              <p className="mk-body mt-4">
                That architecture is the whole point. When a customer starts with invoicing and later needs a support
                desk, nothing gets migrated and nothing gets synced. They switch a module on, and the history that already
                existed is simply there.
              </p>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <GhostCta href="/features">Explore the platform</GhostCta>
                <GhostCta href="/modules">See the modules</GhostCta>
              </div>
            </Reveal>

            <Reveal delay={110}>
              <div className="mk-card p-7">
                <div className="mk-eyebrow text-slate-500">One record, many front doors</div>
                <div className="mt-6 space-y-4">
                  {[
                    { l: 'Eight packaged products', v: '8', d: 'Focused entry points for specific businesses' },
                    { l: 'Modules', v: String(MODULES.length), d: 'Switched on per workspace as needed' },
                    { l: 'Industry blueprints', v: String(SOLUTIONS.length), d: 'Pipelines and fields, installed in one click' },
                    { l: 'Shared foundation', v: '1', d: 'One customer record, one permission model, one audit trail' },
                  ].map((r) => (
                    <div key={r.l} className="flex items-start gap-4 border-b border-white/[0.06] pb-4 last:border-0 last:pb-0">
                      <span className="mk-mono flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-400/25 bg-sky-500/10 text-[15px] font-bold text-sky-300">
                        {r.v}
                      </span>
                      <span className="min-w-0">
                        <span className="mk-h4 block text-white">{r.l}</span>
                        <span className="mk-small mt-0.5 block">{r.d}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* products */}
      <Section id="products" tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Also by abetworks"
            title="Eight products, one platform underneath"
            sub="Each product is a focused front door: its own dashboard, its own navigation, its own quick actions and its own pipeline — with the full NuCRM platform available the moment a customer needs more than the product was scoped for."
          />

          <div className="mt-14 grid gap-4 lg:grid-cols-2">
            {STUDIO_PRODUCTS.map((p, i) => (
              <Reveal key={p.slug} delay={(i % 2) * 70}>
                <Link
                  href={`/abetworks/${p.slug}`}
                  className="mk-card mk-card-hover group relative flex h-full flex-col overflow-hidden p-6"
                >
                  <div
                    className={`pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br ${p.accent} opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-25`}
                    aria-hidden
                  />
                  <div className="relative flex flex-1 flex-col">
                    <div className="flex items-start gap-4">
                      <IconTile name={p.icon} accent={p.accent} size="lg" />
                      <div className="min-w-0 flex-1">
                        <h3 className="mk-h3 text-white">{p.name}</h3>
                        <p className="mk-body mt-1.5">{p.hook}</p>
                      </div>
                    </div>

                    <div className="mt-5 border-t border-white/[0.07] pt-5">
                      <div className="mk-tiny mb-2 uppercase tracking-wider">{p.pipeline.name}</div>
                      <div className="flex flex-wrap gap-1">
                        {p.pipeline.stages.map((s) => (
                          <span
                            key={s}
                            className="rounded border border-white/[0.07] bg-white/[0.03] px-1.5 py-[2px] text-[9.5px] text-slate-500"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {p.workspace.slice(1, 5).map((w) => (
                        <span key={w} className="mk-chip !text-[11px]">
                          {w}
                        </span>
                      ))}
                    </div>

                    <span className="mk-link mt-5 inline-flex items-center gap-1.5 text-[13px]">
                      Look at {p.name}
                      <Icon
                        name="ArrowUpRight"
                        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        strokeWidth={2.2}
                      />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* working with us */}
      <Section>
        <Container>
          <SectionHeading eyebrow="Working with us" title="What to expect if you become a customer" />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: 'A real person replies', d: 'Support is answered by people who work on the product, not a script.', i: 'MessageSquare' },
              { t: 'We ship continuously', d: 'Improvements land weekly, prioritised by what customers actually hit.', i: 'Rocket' },
              { t: 'We tell you what we cannot do', d: 'If NuCRM is the wrong fit, we will say so before you sign, not after.', i: 'HeartHandshake' },
              { t: 'You keep your data', d: 'Full export any time, over the API or as a structured workspace dump.', i: 'Download' },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 60} className="mk-card p-5">
                <IconTile name={c.i} size="sm" />
                <h3 className="mk-h4 mt-4 text-white">{c.t}</h3>
                <p className="mk-small mt-1.5">{c.d}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <CtaBand
        title="Try what we have built"
        sub="Start on the free plan, or tell us what you are trying to fix and we will tell you honestly whether NuCRM is the right tool for it."
        primary={{ label: 'Start free', href: '/auth/signup' }}
        secondary={{ label: 'Talk to us', href: '/contact' }}
      />
    </>
  );
}
