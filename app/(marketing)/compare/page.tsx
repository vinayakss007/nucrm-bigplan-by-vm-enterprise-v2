/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { COMPARE_OVERVIEW, COMPARISONS } from '@/lib/marketing/compare';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import {
  Container,
  CtaBand,
  GhostCta,
  IconTile,
  MatrixValue,
  PageHero,
  PrimaryCta,
  Section,
  SectionHeading,
  StepRow,
} from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'Compare NuCRM with other CRMs',
  description:
    'An honest side-by-side of NuCRM against HubSpot, Salesforce, Pipedrive, Zoho CRM and monday CRM — including where each of them is the better choice.',
  alternates: { canonical: '/compare' },
};

const COLUMNS = ['hubspot', 'salesforce', 'pipedrive', 'zoho', 'monday'] as const;
const LABELS: Record<(typeof COLUMNS)[number], string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  pipedrive: 'Pipedrive',
  zoho: 'Zoho',
  monday: 'monday',
};

export default function ComparePage() {
  return (
    <>
      <PageHero
        eyebrow="Compare"
        title={
          <>
            How NuCRM stacks up, <span className="mk-grad-violet">including where it does not</span>
          </>
        }
        sub="Every tool on this page is good at something, and for some teams one of them is the right answer. We say so on each page. What follows is a comparison of capability and packaging — not a hit piece."
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Compare', href: '/compare' },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free</PrimaryCta>
          <GhostCta href="#matrix">Jump to the matrix</GhostCta>
        </div>
      </PageHero>

      {/* our rules */}
      <Section className="!pt-6">
        <Container>
          <Reveal className="mk-card mk-edge relative overflow-hidden p-7 sm:p-9">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl"
              aria-hidden
            />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_1.1fr]">
              <div>
                <h2 className="mk-h3 text-white">How we write these pages</h2>
                <p className="mk-body mt-3">
                  Comparison pages are usually worthless because the vendor writing them pretends the alternative has no
                  strengths. You have already used these products, so that approach just costs us your trust.
                </p>
              </div>
              <ol className="space-y-3.5">
                <StepRow n={1}>We open by saying what the other product is genuinely good at</StepRow>
                <StepRow n={2}>We only claim NuCRM capabilities that ship today</StepRow>
                <StepRow n={3}>We compare capability and packaging, never marketing budgets</StepRow>
                <StepRow n={4}>We name the buyer for whom the competitor is the better fit</StepRow>
                <StepRow n={5}>Competitor packaging changes often, so we review these pages quarterly</StepRow>
              </ol>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* individual comparisons */}
      <Section tone="soft">
        <Container>
          <SectionHeading eyebrow="One by one" title="Pick your incumbent" />
          <div className="mt-14 grid gap-4 lg:grid-cols-2">
            {COMPARISONS.map((c, i) => (
              <Reveal key={c.slug} delay={(i % 2) * 70}>
                <Link
                  href={`/compare/${c.slug}`}
                  className="mk-card mk-card-hover group flex h-full flex-col overflow-hidden p-6"
                >
                  <div className="flex items-center gap-3">
                    <IconTile name="GitCompareArrows" size="sm" />
                    <h3 className="mk-h3 text-white">
                      NuCRM <span className="text-slate-500">vs</span> {c.competitor}
                    </h3>
                  </div>
                  <p className="mk-body mt-3.5 flex-1">{c.sub}</p>

                  <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <div className="mk-tiny uppercase tracking-wider text-emerald-400/80">
                      Where {c.competitor} wins
                    </div>
                    <p className="mk-small mt-1.5">{c.bestFor.them}</p>
                  </div>

                  <span className="mk-link mt-5 inline-flex items-center gap-1.5 text-[13px]">
                    Read the full comparison
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

      {/* matrix */}
      <Section id="matrix">
        <Container>
          <SectionHeading
            eyebrow="Side by side"
            title="The capability matrix"
            sub="Where a cell says “separate hub”, “add-on” or “integration”, the capability exists in that ecosystem — just not in the product you are comparing, or not at the price you were quoted."
          />

          <Reveal delay={80} className="mk-card mt-12 overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="mk-table min-w-[900px]">
                <thead>
                  <tr>
                    <th className="w-[28%]">Capability</th>
                    <th className="mk-col-own text-center">NuCRM</th>
                    {COLUMNS.map((c) => (
                      <th key={c} className="text-center">
                        {LABELS[c]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_OVERVIEW.map((r) => (
                    <tr key={r.label}>
                      <td className="text-slate-300">{r.label}</td>
                      <td className="mk-col-own text-center">
                        <MatrixValue value={r.nucrm} own />
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c} className="text-center">
                          <MatrixValue value={r[c]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>

          <p className="mk-tiny mx-auto mt-6 max-w-2xl text-center">
            Comparison based on publicly documented product packaging at the time of writing. Vendors change tiers and
            bundles frequently — always confirm against a current quote before you decide.
          </p>
        </Container>
      </Section>

      {/* migration */}
      <Section tone="soft">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <Reveal>
              <SectionHeading align="left" eyebrow="Switching" title="Moving is the part people dread" />
              <p className="mk-body mt-5">
                It is usually the reason teams stay on a tool they have outgrown. The honest answer: a contact and deal
                migration is an afternoon, and rebuilding automations is the part that takes real thought.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <GhostCta href="/contact">Ask us to help with the migration</GhostCta>
              </div>
            </Reveal>
            <div className="space-y-3">
              {[
                { t: 'Export from your current tool', d: 'CSV or API. Contacts, companies, deals, notes and activities.', i: 'Download' },
                { t: 'Map your fields', d: 'Create custom fields inline during the import so nothing collapses into a notes blob.', i: 'SlidersHorizontal' },
                { t: 'Install a blueprint', d: 'Get proper pipelines and stages immediately, then adjust to match your process.', i: 'Wand2' },
                { t: 'Rebuild automations', d: 'Conditions and delays transfer conceptually; the visual builder usually simplifies them.', i: 'GitBranch' },
                { t: 'Run in parallel', d: 'Nothing forces an exclusive cut-over. Keep both live for a month if that helps.', i: 'RefreshCw' },
              ].map((s, i) => (
                <Reveal key={s.t} delay={i * 60} className="mk-card flex gap-3.5 p-4">
                  <IconTile name={s.i} size="sm" />
                  <span className="min-w-0">
                    <span className="mk-h4 block text-white">{s.t}</span>
                    <span className="mk-small mt-1 block">{s.d}</span>
                  </span>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <CtaBand
        title="Try it against your incumbent, on your own data"
        sub="Import a slice of your records into a free workspace and compare like for like. No sales call required to get started."
      />
    </>
  );
}
