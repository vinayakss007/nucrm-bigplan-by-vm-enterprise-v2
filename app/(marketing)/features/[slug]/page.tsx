/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PILLARS, getPillar } from '@/lib/marketing/features';
import { softLower } from '@/lib/marketing/text';
import { MODULES } from '@/lib/marketing/modules';
import { SOLUTIONS } from '@/lib/marketing/solutions';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import {
  AiDraftMock,
  AnalyticsMock,
  AppPreview,
  AutomationMock,
  ConversationMock,
  GovernanceMock,
  QuoteMock,
  TicketMock,
} from '@/components/marketing/mocks';
import {
  Container,
  CtaBand,
  GhostCta,
  IconTile,
  PageHero,
  PrimaryCta,
  Section,
  SectionHeading,
} from '@/components/marketing/ui';

/** Which product screen illustrates each pillar. */
const VISUALS: Record<string, () => React.ReactElement> = {
  'sales-pipeline': AppPreview,
  ai: AiDraftMock,
  automation: AutomationMock,
  conversations: ConversationMock,
  'quote-to-cash': QuoteMock,
  support: TicketMock,
  analytics: AnalyticsMock,
  platform: GovernanceMock,
};

/** Modules most relevant to each pillar, by module id. */
const RELATED_MODULES: Record<string, string[]> = {
  'sales-pipeline': ['core-crm', 'dashboard-leads', 'marketing-segments', 'industry-templates'],
  ai: ['ai-assistant', 'lead-warming', 'automation-pro'],
  automation: ['automation-pro', 'automation-basic', 'lead-warming', 'marketing-segments'],
  conversations: ['whatsapp-bot', 'email-sync', 'forms-builder', 'marketing-segments'],
  'quote-to-cash': ['sales-quotes', 'dashboard-invoices', 'calculated-fields'],
  support: ['service-helpdesk', 'dashboard-tickets', 'compliance'],
  analytics: ['analytics-pro', 'calculated-fields', 'dashboard-core'],
  platform: ['industry-templates', 'compliance', 'project-management'],
};

export function generateStaticParams() {
  return PILLARS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = getPillar(slug);
  if (!p) return {};
  return {
    title: `${p.name} — ${p.headline}`,
    description: p.sub,
    alternates: { canonical: `/features/${p.slug}` },
    openGraph: { title: `${p.name} · NuCRM`, description: p.sub },
  };
}

export default async function PillarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pillar = getPillar(slug);
  if (!pillar) notFound();

  const Visual = VISUALS[pillar.slug] ?? AppPreview;
  const modules = (RELATED_MODULES[pillar.slug] ?? [])
    .map((id) => MODULES.find((m) => m.id === id))
    .filter((m): m is (typeof MODULES)[number] => Boolean(m));
  const related = pillar.related.map((s) => getPillar(s)).filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <>
      <PageHero
        eyebrow={pillar.eyebrow}
        title={pillar.headline}
        sub={pillar.sub}
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Features', href: '/features' },
          { label: pillar.name, href: `/features/${pillar.slug}` },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free</PrimaryCta>
          <GhostCta href="/contact">Book a walkthrough</GhostCta>
        </div>
      </PageHero>

      {/* the screen */}
      <Section className="!pt-4">
        <Container>
          <Reveal className="relative">
            <div
              className={`pointer-events-none absolute -inset-6 -z-10 rounded-[36px] bg-gradient-to-br ${pillar.accent} opacity-[0.16] blur-3xl`}
              aria-hidden
            />
            <Visual />
          </Reveal>
        </Container>
      </Section>

      {/* highlights */}
      <Section tone="soft">
        <Container>
          <SectionHeading eyebrow="What matters here" title="The four things people notice first" />
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {pillar.highlights.map((h, i) => (
              <Reveal key={h.title} delay={(i % 2) * 70} className="mk-card mk-card-hover p-6">
                <IconTile name={h.icon} accent={pillar.accent} />
                <h3 className="mk-h4 mt-4 text-white">{h.title}</h3>
                <p className="mk-body mt-2">{h.desc}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* capability groups */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="In full"
            title={`Everything in ${softLower(pillar.name)}`}
            sub="The complete list, grouped by how you would actually use it."
          />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {pillar.capabilities.map((group, gi) => (
              <Reveal key={group.heading} delay={gi * 70} className="mk-card flex h-full flex-col p-6">
                <h3 className="mk-h4 text-white">{group.heading}</h3>
                <ul className="mt-4 space-y-2.5">
                  {group.items.map((item) => (
                    <li key={item} className="flex gap-2.5">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/70" />
                      <span className="text-[13.5px] leading-relaxed text-slate-400">{item}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* outcomes */}
      <Section tone="soft">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr]">
            <Reveal>
              <SectionHeading align="left" eyebrow="What changes" title="What teams tell us is different" />
              <p className="mk-body mt-5">
                Capability lists are easy. The reason this part of the product exists is to remove specific, recurring
                friction from the week.
              </p>
            </Reveal>
            <div className="space-y-3">
              {pillar.outcomes.map((o, i) => (
                <Reveal key={o} delay={i * 80} className="mk-card flex items-center gap-4 p-5">
                  <span className="mk-mono flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/10 text-emerald-300">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="mk-h4 text-slate-200">{o}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* modules */}
      {modules.length > 0 && (
        <Section>
          <Container>
            <SectionHeading
              eyebrow="Packaging"
              title="Modules that cover this area"
              sub="Switch on only what you need. Enterprise includes every module at no extra cost."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {modules.map((m, i) => (
                <Reveal key={m.id} delay={i * 60}>
                  <Link href="/modules" className="mk-card mk-card-hover group flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <IconTile name={m.icon} accent={m.accent} size="sm" />
                      <span className="mk-mono text-[10.5px] text-slate-500">
                        {m.addOn === 0 ? 'Included' : `+$${m.addOn}/mo`}
                      </span>
                    </div>
                    <span className="mk-h4 mt-4 text-white">{m.name}</span>
                    <span className="mk-small mt-1.5 flex-1">{m.summary}</span>
                    <span className="mk-tiny mt-3 uppercase tracking-wider">From {m.from}</span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </Container>
        </Section>
      )}

      {/* industries + related pillars */}
      <Section tone="soft">
        <Container>
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <SectionHeading align="left" eyebrow="Related reading" title="Other parts of the platform" />
              <div className="mt-8 space-y-3">
                {related.map((r, i) => (
                  <Reveal key={r.slug} delay={i * 70}>
                    <Link
                      href={`/features/${r.slug}`}
                      className="mk-card mk-card-hover group flex items-start gap-3.5 p-4"
                    >
                      <IconTile name={r.icon} accent={r.accent} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="mk-h4 block text-white">{r.name}</span>
                        <span className="mk-small mt-1 block">{r.blurb}</span>
                      </span>
                      <Icon
                        name="ArrowUpRight"
                        className="h-4 w-4 shrink-0 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-violet-300"
                      />
                    </Link>
                  </Reveal>
                ))}
              </div>
            </div>

            <div>
              <SectionHeading align="left" eyebrow="Your sector" title="See it configured for your industry" />
              <div className="mt-8 flex flex-wrap gap-2">
                {SOLUTIONS.map((s) => (
                  <Link
                    key={s.slug}
                    href={`/solutions/${s.slug}`}
                    className="mk-chip hover:!border-violet-400/30 hover:!text-white"
                  >
                    <Icon name={s.icon} className="h-3.5 w-3.5 text-violet-300" />
                    {s.name}
                  </Link>
                ))}
              </div>
              <p className="mk-small mt-6">
                Each blueprint installs the pipelines, custom fields and automations that fit that business — in one
                click, on a new workspace or an existing one.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <GhostCta href="/solutions">All industry blueprints</GhostCta>
                <GhostCta href="/compare">Compare with other CRMs</GhostCta>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <CtaBand
        title={`Try ${softLower(pillar.name)} on your own data`}
        sub="Start free, import your records, and see whether it holds up against how your team actually works."
      />
    </>
  );
}
