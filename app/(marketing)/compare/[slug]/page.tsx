/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { COMPARISONS, getComparison } from '@/lib/marketing/compare';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import {
  Container,
  CtaBand,
  GhostCta,
  IconTile,
  PageHero,
  PrimaryCta,
  Section,
  SectionHeading,
  StepRow,
} from '@/components/marketing/ui';

export function generateStaticParams() {
  return COMPARISONS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = getComparison(slug);
  if (!c) return {};
  return {
    title: `${c.headline} — ${c.hook}`,
    description: c.sub,
    alternates: { canonical: `/compare/${c.slug}` },
    openGraph: { title: c.headline, description: c.sub },
  };
}

export default async function ComparisonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getComparison(slug);
  if (!c) notFound();

  const others = COMPARISONS.filter((o) => o.slug !== c.slug);

  return (
    <>
      <PageHero
        eyebrow={`NuCRM vs ${c.competitor}`}
        title={c.hook}
        sub={c.sub}
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Compare', href: '/compare' },
          { label: c.competitor, href: `/compare/${c.slug}` },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free</PrimaryCta>
          <GhostCta href="/features">See what NuCRM includes</GhostCta>
        </div>
      </PageHero>

      {/* credit where due — first, deliberately */}
      <Section className="!pt-6">
        <Container>
          <Reveal className="mk-card relative overflow-hidden p-7 sm:p-9">
            <div
              className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-emerald-500/12 blur-3xl"
              aria-hidden
            />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <div className="mk-eyebrow text-emerald-300/90">Credit where it is due</div>
                <h2 className="mk-h3 mt-3 text-white">What {c.competitor} genuinely does well</h2>
                <p className="mk-body mt-3">
                  If any of the points opposite describe the problem you are actually solving, {c.competitor} may well be
                  your answer — and we would rather you knew that now.
                </p>
              </div>
              <ul className="space-y-3">
                {c.fairPoints.map((p) => (
                  <li key={p} className="flex gap-3">
                    <Icon name="Check" className="mt-[3px] h-4 w-4 shrink-0 text-emerald-400" strokeWidth={2.4} />
                    <span className="mk-body text-slate-300">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* friction */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Where it gets uncomfortable"
            title={`Why teams start looking past ${c.competitor}`}
            sub="These are the recurring reasons people arrive on this page. If none of them apply to you, stay where you are."
          />
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {c.friction.map((f, i) => (
              <Reveal key={f.title} delay={i * 70} className="mk-card p-6">
                <span className="mk-mono flex h-9 w-9 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-500/10 text-amber-300">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mk-h4 mt-4 text-white">{f.title}</h3>
                <p className="mk-body mt-2">{f.body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* answers */}
      <Section>
        <Container>
          <SectionHeading eyebrow="Our answer" title="How NuCRM approaches it differently" />
          <div className="mt-14 grid gap-4 sm:grid-cols-2">
            {c.answers.map((a, i) => (
              <Reveal key={a.title} delay={(i % 2) * 70} className="mk-card mk-card-hover p-6">
                <IconTile name={a.icon} />
                <h3 className="mk-h4 mt-4 text-white">{a.title}</h3>
                <p className="mk-body mt-2">{a.body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* the table */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Side by side"
            title={`NuCRM and ${c.competitor}, line by line`}
            sub="Based on publicly documented packaging at the time of writing. Always confirm against a current quote."
          />
          <Reveal delay={80} className="mk-card mx-auto mt-12 max-w-4xl overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="mk-table min-w-[640px]">
                <thead>
                  <tr>
                    <th className="w-[38%]">Capability</th>
                    <th className="mk-col-own">NuCRM</th>
                    <th>{c.competitor}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.matrix.map((r) => (
                    <tr key={r.label}>
                      <td className="text-slate-300">{r.label}</td>
                      <td className="mk-col-own font-medium">{r.nucrm}</td>
                      <td className="text-slate-400">{r.them}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* best for */}
      <Section>
        <Container>
          <SectionHeading eyebrow="Straight answer" title="Which one should you actually buy?" />
          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            <Reveal className="mk-card mk-edge relative overflow-hidden p-7">
              <div
                className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-violet-500/20 blur-3xl"
                aria-hidden
              />
              <div className="relative">
                <div className="mk-eyebrow text-violet-300/90">Choose NuCRM if</div>
                <p className="mk-lead mt-4 !text-slate-200">{c.bestFor.nucrm}</p>
                <div className="mt-6">
                  <PrimaryCta>Start free</PrimaryCta>
                </div>
              </div>
            </Reveal>
            <Reveal delay={90} className="mk-card p-7">
              <div className="mk-eyebrow text-emerald-300/90">Choose {c.competitor} if</div>
              <p className="mk-lead mt-4 !text-slate-200">{c.bestFor.them}</p>
              <p className="mk-small mt-6">
                We would rather you bought the right thing than churned in six months. If that is you, thanks for
                reading — and good luck with the rollout.
              </p>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* migration */}
      <Section tone="soft">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <Reveal>
              <SectionHeading align="left" eyebrow="Switching" title={`Moving off ${c.competitor}`} />
              <p className="mk-body mt-5">
                A realistic sequence, not a promise that it happens by magic. The data is quick; the automations are
                where you should spend your thinking time.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <GhostCta href="/contact">Get help with the migration</GhostCta>
                <GhostCta href="/pricing">See what it would cost</GhostCta>
              </div>
            </Reveal>
            <ol className="space-y-3.5">
              {c.switching.map((step, i) => (
                <Reveal key={step} delay={i * 60}>
                  <div className="mk-card p-4">
                    <StepRow n={i + 1}>{step}</StepRow>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      {/* other comparisons */}
      <Section>
        <Container>
          <SectionHeading eyebrow="Also comparing" title="Other side-by-sides" />
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {others.map((o, i) => (
              <Reveal key={o.slug} delay={i * 60}>
                <Link href={`/compare/${o.slug}`} className="mk-card mk-card-hover group flex h-full flex-col p-5">
                  <IconTile name="GitCompareArrows" size="sm" />
                  <span className="mk-h4 mt-4 text-white">vs {o.competitor}</span>
                  <span className="mk-small mt-1.5 flex-1">{o.hook}</span>
                  <Icon
                    name="ArrowUpRight"
                    className="mt-4 h-4 w-4 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-violet-300"
                  />
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <CtaBand
        title={`See it next to ${c.competitor}, on your data`}
        sub="Import a slice of your records into a free workspace and judge it yourself. That is a better comparison than any table we could write."
      />
    </>
  );
}
