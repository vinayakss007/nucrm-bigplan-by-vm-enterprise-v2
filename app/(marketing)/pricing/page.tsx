import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { PLANS, PLAN_MATRIX, PRICING_FAQ } from '@/lib/marketing/pricing';
import { MODULES, type PlanKey } from '@/lib/marketing/modules';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { Faq } from '@/components/marketing/faq';
import {
  Container,
  CtaBand,
  GhostCta,
  IconTile,
  MatrixValue,
  PageHero,
  Section,
  SectionHeading,
} from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'Pricing — per user, plus the modules you choose',
  description:
    'NuCRM pricing: a free plan forever, Starter, Pro and Enterprise. No contact bands, no marketing tier maths. See exactly which capabilities each plan includes.',
  alternates: { canonical: '/pricing' },
};

const PLAN_KEYS = ['free', 'starter', 'pro', 'enterprise'] as const;

const PLAN_LABEL: Record<PlanKey, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export default function PricingPage() {
  const addOns = MODULES.filter((m) => m.addOn > 0);

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title={
          <>
            Priced so you can <span className="mk-grad-violet">predict next year</span>
          </>
        }
        sub="Per user, plus the modules you switch on. No contact bands, no marketing-tier arithmetic, no discovering that the feature your team now depends on lives two tiers up."
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Pricing', href: '/pricing' },
        ]}
      />

      {/* plans */}
      <Section className="!pt-4">
        <Container>
          <div className="grid gap-4 lg:grid-cols-4">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.id} delay={i * 70}>
                <div
                  className={`relative flex h-full flex-col rounded-2xl border p-6 ${
                    plan.featured
                      ? 'mk-edge border-violet-400/30 bg-gradient-to-b from-violet-600/[0.14] to-white/[0.02]'
                      : 'border-white/[0.08] bg-white/[0.025]'
                  }`}
                >
                  {plan.featured && (
                    <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-white shadow-lg shadow-violet-500/30">
                      Most teams
                    </span>
                  )}
                  <h2 className="mk-h4 text-white">{plan.name}</h2>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-[36px] font-extrabold leading-none tracking-tight text-white">
                      {plan.price}
                    </span>
                    <span className="mk-tiny">{plan.period}</span>
                  </div>
                  <p className="mk-small mt-3 min-h-[60px]">{plan.pitch}</p>
                  <Link
                    href={plan.cta.href}
                    className={`mk-btn mt-3 w-full ${plan.featured ? 'mk-btn-primary' : 'mk-btn-ghost'}`}
                  >
                    {plan.cta.label}
                  </Link>

                  <dl className="mt-6 grid grid-cols-2 gap-x-3 gap-y-3 border-y border-white/[0.07] py-4">
                    {plan.limits.map((l) => (
                      <div key={l.label}>
                        <dt className="mk-tiny uppercase tracking-wider">{l.label}</dt>
                        <dd className="mt-0.5 text-[13px] font-semibold text-slate-200">{l.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <ul className="mt-5 space-y-2">
                    {plan.includes.map((f) => (
                      <li key={f} className="flex gap-2.5">
                        <Icon
                          name="Check"
                          className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${plan.featured ? 'text-violet-300' : 'text-emerald-400'}`}
                          strokeWidth={2.6}
                        />
                        <span className="text-[12.5px] leading-relaxed text-slate-400">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>

          <p className="mk-tiny mt-8 text-center">
            Prices in USD, billed monthly or annually. Annual billing carries a discount — ask us for current terms.
          </p>
        </Container>
      </Section>

      {/* add-on modules */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Modules"
            title="Add only what you will use"
            sub={`Core CRM, the default dashboard and the starter automations are on every plan, including Free. The ${addOns.length} modules below are per-workspace add-ons — and Enterprise includes every one of them at no extra cost.`}
          />

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {addOns.map((m, i) => (
              <Reveal key={m.id} delay={(i % 3) * 50}>
                <Link href="/modules" className="mk-card mk-card-hover group flex h-full items-start gap-3.5 p-4">
                  <IconTile name={m.icon} accent={m.accent} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="mk-h4 text-white">{m.name}</span>
                      <span className="mk-mono ml-auto shrink-0 text-[11px] text-violet-300">+${m.addOn}/mo</span>
                    </span>
                    <span className="mk-small mt-1 block">{m.summary}</span>
                    <span className="mk-tiny mt-2 block uppercase tracking-wider">Available from {PLAN_LABEL[m.from]}</span>
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>

          <Reveal delay={80} className="mt-8 text-center">
            <GhostCta href="/modules">See what every module includes</GhostCta>
          </Reveal>
        </Container>
      </Section>

      {/* matrix */}
      <Section id="matrix">
        <Container>
          <SectionHeading
            eyebrow="Plan comparison"
            title="What each plan actually includes"
            sub="“Add-on” means the capability is available on that plan as a paid module rather than bundled."
          />

          <Reveal delay={80} className="mk-card mt-12 overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="mk-table min-w-[760px]">
                <thead>
                  <tr>
                    <th className="w-[40%]">Capability</th>
                    <th className="text-center">Free</th>
                    <th className="text-center">Starter</th>
                    <th className="mk-col-own text-center">Pro</th>
                    <th className="text-center">Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_MATRIX.map((group) => (
                    <Fragment key={group.group}>
                      <tr>
                        <td colSpan={5} className="!py-3 !pl-4">
                          <span className="mk-eyebrow text-violet-300/90">{group.group}</span>
                        </td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={group.group + row.label}>
                          <td className="!pl-4 text-slate-300">{row.label}</td>
                          {PLAN_KEYS.map((k) => (
                            <td key={k} className={`text-center ${k === 'pro' ? 'mk-col-own' : ''}`}>
                              <MatrixValue value={row[k]} own={k === 'pro'} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* enterprise */}
      <Section tone="soft">
        <Container>
          <Reveal className="mk-card mk-edge relative overflow-hidden p-7 sm:p-10">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-violet-500/20 blur-3xl"
              aria-hidden
            />
            <div className="relative grid gap-10 lg:grid-cols-[1fr_1.15fr]">
              <div>
                <div className="mk-eyebrow text-violet-300/90">Enterprise</div>
                <h2 className="mk-h2 mt-3 text-white">When the procurement questionnaire arrives</h2>
                <p className="mk-lead mt-4">
                  Every module included, multiple isolated workspaces under one account, single sign-on, white label, and
                  a contract with a service-level agreement attached.
                </p>
                <div className="mt-7 flex flex-wrap gap-2.5">
                  <Link href="/contact" className="mk-btn mk-btn-primary">
                    Talk to sales
                  </Link>
                  <GhostCta href="/security">Read the security overview</GhostCta>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { t: 'All modules included', i: 'Blocks' },
                  { t: 'Multiple isolated workspaces', i: 'Layers' },
                  { t: 'SSO with SAML and OIDC', i: 'KeyRound' },
                  { t: 'Field-level permissions', i: 'ShieldCheck' },
                  { t: 'White label and custom domain', i: 'Globe' },
                  { t: 'IP allow-listing and DLP', i: 'Lock' },
                  { t: 'Backups with selective restore', i: 'DatabaseBackup' },
                  { t: 'Named contact and SLA', i: 'FileCheck' },
                  { t: 'Private deployment option', i: 'Database' },
                  { t: 'Onboarding and migration help', i: 'HeartHandshake' },
                ].map((f) => (
                  <div key={f.t} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                    <Icon name={f.i} className="h-4 w-4 shrink-0 text-violet-300" />
                    <span className="text-[12.5px] font-medium text-slate-300">{f.t}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* faq */}
      <Section id="faq">
        <Container>
          <SectionHeading eyebrow="Questions" title="Pricing questions, answered plainly" />
          <div className="mt-12">
            <Faq items={PRICING_FAQ} />
          </div>
        </Container>
      </Section>

      <CtaBand
        title="Start on the free plan and decide later"
        sub="No card, no trial countdown on the core CRM. Upgrade when a module you actually need sits above your plan."
      />
    </>
  );
}
