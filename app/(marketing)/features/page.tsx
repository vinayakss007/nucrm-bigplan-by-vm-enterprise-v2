import type { Metadata } from 'next';
import Link from 'next/link';
import { FEATURE_CATALOG, PILLARS } from '@/lib/marketing/features';
import { MODULES } from '@/lib/marketing/modules';
import { PLATFORM_STATS } from '@/lib/marketing/site';
import { Icon } from '@/components/marketing/icon';
import { AnimatedNumber, Reveal } from '@/components/marketing/reveal';
import { AppPreview } from '@/components/marketing/mocks';
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

export const metadata: Metadata = {
  title: 'Features — everything NuCRM does',
  description:
    'The complete NuCRM capability map: sales pipeline, AI assistant, automation, omnichannel conversations, quote to cash, support desk, analytics and platform governance — in one product.',
  alternates: { canonical: '/features' },
};

export default function FeaturesPage() {
  const totalRows = FEATURE_CATALOG.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <PageHero
        eyebrow="The platform"
        title={
          <>
            Everything NuCRM does, <span className="mk-grad-violet">without the brochure language</span>
          </>
        }
        sub={`Eight capability areas, ${MODULES.length} modules and ${totalRows} named capabilities — all sharing one customer record, one permission model and one audit trail. Start with the pillars, then read the full catalogue below.`}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free</PrimaryCta>
          <GhostCta href="#catalogue">Jump to the full catalogue</GhostCta>
        </div>
      </PageHero>

      {/* pillars */}
      <Section className="!pt-6">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2">
            {PILLARS.map((p, i) => (
              <Reveal key={p.slug} delay={(i % 2) * 70}>
                <Link
                  href={`/features/${p.slug}`}
                  className="mk-card mk-card-hover group flex h-full flex-col overflow-hidden p-6"
                >
                  <div className="flex items-start gap-4">
                    <IconTile name={p.icon} accent={p.accent} />
                    <div className="min-w-0 flex-1">
                      <h2 className="mk-h3 text-white">{p.name}</h2>
                      <p className="mk-body mt-2">{p.sub}</p>
                    </div>
                  </div>

                  <ul className="mt-5 grid gap-2 border-t border-white/[0.07] pt-5 sm:grid-cols-2">
                    {p.highlights.map((h) => (
                      <li key={h.title} className="flex items-start gap-2">
                        <Icon name={h.icon} className="mt-[3px] h-3.5 w-3.5 shrink-0 text-violet-400" />
                        <span className="text-[12.5px] leading-snug text-slate-400">{h.title}</span>
                      </li>
                    ))}
                  </ul>

                  <span className="mk-link mt-5 inline-flex items-center gap-1.5 text-[13px]">
                    Read the detail
                    <Icon
                      name="ArrowUpRight"
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      strokeWidth={2.2}
                    />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* screen shot + scale */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Purpose-built, not generic"
            title="Screens designed for the job, not one layout bent into every shape"
            sub="Most platforms give you a record page and a table, then ask you to configure your way to a workflow. NuCRM ships the screen each job needs — a board for deals, a queue for tickets, an editor for quotes, a builder for automations."
          />
          <Reveal delay={100} className="mt-12">
            <AppPreview />
          </Reveal>
          <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
            {PLATFORM_STATS.map((s, i) => (
              <Reveal key={s.label} delay={i * 70} className="text-center">
                <div className="mk-h2 mk-grad-violet">
                  <AnimatedNumber target={s.value} suffix={s.suffix} />
                </div>
                <div className="mk-h4 mt-1.5 text-slate-200">{s.label}</div>
                <div className="mk-tiny mt-1">{s.sub}</div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* full catalogue */}
      <Section id="catalogue">
        <Container>
          <SectionHeading
            eyebrow="Full catalogue"
            title="Every capability, named"
            sub="No asterisks, no “available on request”. If it is on this list, it ships in the product today."
          />

          <div className="mt-14 space-y-10">
            {FEATURE_CATALOG.map((group, gi) => (
              <Reveal key={group.group} delay={gi * 40}>
                <div className="mk-card overflow-hidden !p-0">
                  <div className="flex items-center gap-3.5 border-b border-white/[0.07] bg-white/[0.02] px-5 py-4 sm:px-6">
                    <IconTile name={group.icon} accent={group.accent} size="sm" />
                    <h3 className="mk-h4 text-white">{group.group}</h3>
                    <span className="mk-mono ml-auto text-[11px] text-slate-600">{group.rows.length}</span>
                  </div>
                  <dl className="divide-y divide-white/[0.05]">
                    {group.rows.map((row) => (
                      <div
                        key={row.name}
                        className="grid gap-1 px-5 py-3.5 transition-colors hover:bg-white/[0.02] sm:grid-cols-[220px_1fr] sm:gap-6 sm:px-6"
                      >
                        <dt className="text-[13.5px] font-semibold text-slate-200">{row.name}</dt>
                        <dd className="text-[13.5px] leading-relaxed text-slate-400">{row.detail}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={80} className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <GhostCta href="/modules">See how modules are packaged</GhostCta>
            <GhostCta href="/pricing">Which plan includes what</GhostCta>
            <GhostCta href="/compare">Compare with other CRMs</GhostCta>
          </Reveal>
        </Container>
      </Section>

      {/* where next */}
      <Section tone="soft">
        <Container>
          <SectionHeading eyebrow="Where next" title="Keep reading" />
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              { t: 'Industry blueprints', d: 'See the pipelines and fields installed for your sector.', h: '/solutions', i: 'Wand2' },
              { t: 'Module marketplace', d: 'What each module includes and what it costs.', h: '/modules', i: 'Blocks' },
              { t: 'Security & compliance', d: 'Isolation, permissions, audit, GDPR and backups.', h: '/security', i: 'ShieldCheck' },
            ].map((c, i) => (
              <Reveal key={c.h} delay={i * 70}>
                <Link href={c.h} className="mk-card mk-card-hover group flex h-full flex-col p-5">
                  <IconTile name={c.i} size="sm" />
                  <span className="mk-h4 mt-4 text-white">{c.t}</span>
                  <span className="mk-small mt-1.5 flex-1">{c.d}</span>
                  <span className="mt-4">
                    <span className="mk-link group inline-flex items-center gap-1.5 text-sm">
                      Open
                      <Icon name="ArrowUpRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.2} />
                    </span>
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <CtaBand />
    </>
  );
}
