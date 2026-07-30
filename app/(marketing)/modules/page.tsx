import type { Metadata } from 'next';
import Link from 'next/link';
import { MODULES, MODULE_CATEGORIES, type PlanKey } from '@/lib/marketing/modules';
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
} from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: `Module marketplace — ${MODULES.length} modules`,
  description:
    'NuCRM ships as modules you switch on individually: AI assistant, automation builder, WhatsApp, email sync, quotes, helpdesk, analytics, compliance and more. See what each includes.',
  alternates: { canonical: '/modules' },
};

const PLAN_LABEL: Record<PlanKey, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export default function ModulesPage() {
  const included = MODULES.filter((m) => m.addOn === 0);
  const paid = MODULES.filter((m) => m.addOn > 0);

  return (
    <>
      <PageHero
        eyebrow="Module marketplace"
        title={
          <>
            {MODULES.length} modules. <span className="mk-grad-violet">Switch on what you need.</span>
          </>
        }
        sub="Most platforms bundle features into tiers, so you buy nine things to get the one you wanted. NuCRM is assembled from modules: each one has a clear job, a clear price, and can be turned off again."
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Modules', href: '/modules' },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free</PrimaryCta>
          <GhostCta href="/pricing">See plan pricing</GhostCta>
        </div>
      </PageHero>

      {/* how packaging works */}
      <Section className="!pt-6">
        <Container>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                t: `${included.length} included on your plan`,
                d: 'Core CRM, the default dashboard and the starter automations are always on — even on Free.',
                i: 'Gift',
                accent: 'from-emerald-400 to-teal-500',
              },
              {
                t: `${paid.length} available as add-ons`,
                d: 'Priced per workspace per month, from $10. Add one for a quarter and remove it if it did not earn its keep.',
                i: 'Blocks',
                accent: 'from-violet-500 to-indigo-500',
              },
              {
                t: 'All of them on Enterprise',
                d: 'Enterprise agreements include every module at no additional cost, present and future.',
                i: 'ShieldCheck',
                accent: 'from-cyan-400 to-blue-500',
              },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 70} className="mk-card p-6">
                <IconTile name={c.i} accent={c.accent} />
                <h2 className="mk-h4 mt-4 text-white">{c.t}</h2>
                <p className="mk-body mt-2">{c.d}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* by category */}
      {MODULE_CATEGORIES.map((category) => {
        const items = MODULES.filter((m) => m.category === category);
        if (items.length === 0) return null;
        return (
          <Section key={category} tone={MODULE_CATEGORIES.indexOf(category) % 2 === 0 ? 'soft' : 'plain'}>
            <Container>
              <Reveal className="mb-10 flex items-end justify-between gap-6">
                <div>
                  <span className="mk-eyebrow text-violet-300/90">{category}</span>
                  <h2 className="mk-h2 mt-3 text-white">
                    {items.length} module{items.length === 1 ? '' : 's'}
                  </h2>
                </div>
              </Reveal>

              <div className="grid gap-4 lg:grid-cols-2">
                {items.map((m, i) => (
                  <Reveal key={m.id} delay={(i % 2) * 70} className="mk-card mk-card-hover flex h-full flex-col p-6">
                    <div className="flex items-start gap-4">
                      <IconTile name={m.icon} accent={m.accent} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h3 className="mk-h3 text-white">{m.name}</h3>
                          <span
                            className={`mk-mono rounded-md border px-2 py-[2px] text-[11px] ${
                              m.addOn === 0
                                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                                : 'border-violet-400/25 bg-violet-500/10 text-violet-300'
                            }`}
                          >
                            {m.addOn === 0 ? 'Included' : `+$${m.addOn}/mo`}
                          </span>
                        </div>
                        <p className="mk-body mt-2">{m.summary}</p>
                      </div>
                    </div>

                    <ul className="mt-5 grid flex-1 gap-1.5 border-t border-white/[0.07] pt-5 sm:grid-cols-2">
                      {m.features.slice(0, 10).map((f) => (
                        <li key={f} className="flex gap-2">
                          <Icon name="Check" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-violet-400" strokeWidth={2.4} />
                          <span className="text-[12.5px] leading-snug text-slate-400">{f}</span>
                        </li>
                      ))}
                    </ul>
                    {m.features.length > 10 && (
                      <p className="mk-tiny mt-2">+{m.features.length - 10} more in this module</p>
                    )}

                    <div className="mk-tiny mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.07] pt-4">
                      <span>
                        Available from <span className="font-semibold text-slate-300">{PLAN_LABEL[m.from]}</span>
                      </span>
                      {m.includedIn.length > 0 && (
                        <span>
                          Bundled with{' '}
                          <span className="font-semibold text-slate-300">
                            {m.includedIn.map((p) => PLAN_LABEL[p]).join(', ')}
                          </span>
                        </span>
                      )}
                    </div>
                  </Reveal>
                ))}
              </div>
            </Container>
          </Section>
        );
      })}

      {/* build your own */}
      <Section tone="soft">
        <Container>
          <Reveal className="mk-card mk-edge relative overflow-hidden p-7 sm:p-10">
            <div
              className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl"
              aria-hidden
            />
            <div className="relative grid gap-10 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <div className="mk-eyebrow text-cyan-300/90">Extensibility</div>
                <h2 className="mk-h2 mt-3 text-white">Or build your own module</h2>
                <p className="mk-lead mt-4">
                  The module system is not just how we ship features — it is available to you. Build an extension with its
                  own screens, its own data and its own permissions, on top of the same platform.
                </p>
                <div className="mt-7 flex flex-wrap gap-2.5">
                  <GhostCta href="/integrations#api">Developer API</GhostCta>
                  <GhostCta href="/contact">Talk to an engineer</GhostCta>
                </div>
              </div>
              <ul className="space-y-3">
                {[
                  'Register your own screens inside the workspace navigation',
                  'Define your own tables and fields without touching core records',
                  'Declare permissions so your module respects existing roles',
                  'Subscribe to platform events and emit your own webhooks',
                  'Ship it to one workspace, or offer it to others',
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <Icon name="Check" className="mt-[3px] h-4 w-4 shrink-0 text-cyan-300" strokeWidth={2.4} />
                    <span className="mk-body text-slate-300">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={80} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <GhostCta href="/features">See the full feature catalogue</GhostCta>
            <Link href="/pricing" className="mk-btn mk-btn-ghost">
              Compare plans
            </Link>
          </Reveal>
        </Container>
      </Section>

      <CtaBand
        title="Start with the core, add the rest when you need it"
        sub="The free plan includes a real pipeline, not a countdown. Switch modules on the day they become useful."
      />
    </>
  );
}
