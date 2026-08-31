/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { SOLUTIONS } from '@/lib/marketing/solutions';
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

export const metadata: Metadata = {
  title: 'Solutions by industry',
  description: `NuCRM ships ${SOLUTIONS.length} industry blueprints. Pick yours and the pipelines, custom fields and automations that fit that business are installed in one click.`,
  alternates: { canonical: '/solutions' },
};

export default function SolutionsPage() {
  const totalPipelines = SOLUTIONS.reduce((n, s) => n + s.pipelines.length, 0);

  return (
    <>
      <PageHero
        eyebrow="Industry blueprints"
        title={
          <>
            A CRM that already knows <span className="mk-grad-violet">how your industry sells</span>
          </>
        }
        sub={`Generic CRMs hand you an empty pipeline and a configuration project. NuCRM ships ${SOLUTIONS.length} blueprints covering ${totalPipelines} real pipelines — installed, with the custom fields and automations that go with them, in one click.`}
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Solutions', href: '/solutions' },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free</PrimaryCta>
          <GhostCta href="/features">See the platform</GhostCta>
        </div>
      </PageHero>

      {/* how it works */}
      <Section className="!pt-6">
        <Container>
          <div className="mk-card mk-edge relative overflow-hidden p-7 sm:p-9">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-sky-500/22 blur-3xl"
              aria-hidden
            />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_1.1fr]">
              <div>
                <h2 className="mk-h3 text-white">What “one click” actually does</h2>
                <p className="mk-body mt-3">
                  A blueprint is not a demo dataset. It writes real configuration into your workspace, which you are then
                  free to rename, reorder or delete.
                </p>
              </div>
              <ol className="space-y-3.5">
                <StepRow n={1}>Creates the pipelines and stages that sector uses, ready for deals</StepRow>
                <StepRow n={2}>Adds the custom fields on contacts, companies and deals that the work needs</StepRow>
                <StepRow n={3}>Switches on the automations that stop the usual things being forgotten</StepRow>
                <StepRow n={4}>Leaves the rest of the platform fully available, so nothing is fenced off</StepRow>
              </ol>
            </div>
          </div>
        </Container>
      </Section>

      {/* the grid */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Choose yours"
            title={`${SOLUTIONS.length} blueprints`}
            sub="Each one lists the exact pipelines, fields and automations it installs — so you can check the fit before you sign up, not after."
          />

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SOLUTIONS.map((s, i) => (
              <Reveal key={s.slug} delay={(i % 3) * 60}>
                <Link
                  href={`/solutions/${s.slug}`}
                  className="mk-card mk-card-hover group flex h-full flex-col overflow-hidden p-6"
                >
                  <div
                    className={`pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-gradient-to-br ${s.accent} opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-20`}
                    aria-hidden
                  />
                  <div className="relative flex flex-1 flex-col">
                    <IconTile name={s.icon} accent={s.accent} />
                    <h3 className="mk-h4 mt-4 text-white">{s.name}</h3>
                    <p className="mk-small mt-1.5">{s.blurb}</p>

                    <div className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-5">
                      {s.pipelines.map((p) => (
                        <div key={p.name}>
                          <div className="mk-tiny mb-1.5 uppercase tracking-wider">{p.name}</div>
                          <div className="flex flex-wrap gap-1">
                            {p.stages.map((st) => (
                              <span
                                key={st}
                                className="rounded border border-white/[0.07] bg-white/[0.03] px-1.5 py-[2px] text-[9.5px] text-slate-500"
                              >
                                {st}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mk-tiny mt-5 flex items-center gap-3 border-t border-white/[0.07] pt-4">
                      <span>{s.fields.length} custom fields</span>
                      <span className="h-3 w-px bg-white/10" />
                      <span>
                        {s.automations.length} automation{s.automations.length === 1 ? '' : 's'}
                      </span>
                      <Icon
                        name="ArrowUpRight"
                        className="ml-auto h-4 w-4 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-sky-300"
                      />
                    </div>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* not listed */}
      <Section>
        <Container>
          <div className="mk-card grid gap-8 p-7 sm:p-9 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="mk-h3 text-white">Your industry is not on the list?</h2>
              <p className="mk-body mt-3">
                Blueprints are a shortcut, not a constraint. Every workspace can define its own pipelines, stages, custom
                fields, picklists, formulas and automations — so an unusual process is a configuration exercise, not a
                feature request.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <GhostCta href="/features/platform">How configuration works</GhostCta>
                <GhostCta href="/contact">Tell us what you need</GhostCta>
              </div>
            </div>
            <ul className="space-y-2.5">
              {[
                'Unlimited pipelines with your own stage names',
                'Custom fields on every entity, in the types you need',
                'Formula fields for anything that has to be calculated',
                'Approval chains for the steps that need a sign-off',
                'Territories, teams and hierarchy that match your org',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Icon name="Check" className="mt-[3px] h-4 w-4 shrink-0 text-sky-400" strokeWidth={2.4} />
                  <span className="mk-body text-slate-300">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      <CtaBand
        title="Install your blueprint and start working today"
        sub="Sign up free, choose your industry, import your contacts. You will have a working pipeline before the end of the afternoon."
      />
    </>
  );
}
