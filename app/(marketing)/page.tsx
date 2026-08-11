import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND, PLATFORM_STATS } from '@/lib/marketing/site';
import { PILLARS } from '@/lib/marketing/features';
import { softLower } from '@/lib/marketing/text';
import { SOLUTIONS } from '@/lib/marketing/solutions';
import { MODULES } from '@/lib/marketing/modules';
import { PLANS, PRICING_FAQ } from '@/lib/marketing/pricing';
import { COMPARE_OVERVIEW } from '@/lib/marketing/compare';
import { CONNECTORS } from '@/lib/marketing/integrations';
import { Icon } from '@/components/marketing/icon';
import { AnimatedNumber, MagneticButton, Reveal, StaggerText, TiltCard } from '@/components/marketing/reveal';
import { Faq } from '@/components/marketing/faq';
import { ProductTour, type TourTab } from '@/components/marketing/product-tour';
import {
  AiDraftMock,
  AnalyticsMock,
  AppPreview,
  AutomationMock,
  ConversationMock,
  QuoteMock,
} from '@/components/marketing/mocks';
import {
  Aurora,
  CheckList,
  Chip,
  Container,
  CtaBand,
  Eyebrow,
  GhostCta,
  IconTile,
  Marquee,
  MatrixValue,
  PrimaryCta,
  Section,
  SectionHeading,
  TextLink,
} from '@/components/marketing/ui';

export const metadata: Metadata = {
  // The layout template would append "| NuCRM by abetworks"; the landing page
  // owns its full title instead.
  title: {
    absolute: `${BRAND.product} by ${BRAND.maker} — ${BRAND.promise}`,
  },
  description: BRAND.description,
  alternates: { canonical: '/' },
};

/* The stack a mid-sized team typically pays for before consolidating. */
const REPLACES = [
  { tool: 'CRM & pipeline', icon: 'Kanban' },
  { tool: 'Support helpdesk', icon: 'LifeBuoy' },
  { tool: 'Quoting & invoicing', icon: 'Receipt' },
  { tool: 'E-signature', icon: 'PenTool' },
  { tool: 'Email sequences', icon: 'Mails' },
  { tool: 'WhatsApp & SMS tool', icon: 'MessageCircle' },
  { tool: 'Form builder', icon: 'ClipboardList' },
  { tool: 'Knowledge base', icon: 'BookOpen' },
  { tool: 'Reporting & BI', icon: 'BarChart3' },
  { tool: 'Project tracker', icon: 'FolderKanban' },
  { tool: 'Customer portal', icon: 'Globe' },
  { tool: 'Workflow automation', icon: 'Zap' },
];

/* Asymmetric bento: the first two tiles are wide, the rest fill the grid. */
const BENTO = [
  {
    slug: 'sales-pipeline',
    span: 'lg:col-span-3',
    stat: 'Unlimited pipelines',
  },
  { slug: 'ai', span: 'lg:col-span-3', stat: '8 assistant skills' },
  { slug: 'automation', span: 'lg:col-span-2', stat: 'Visual builder' },
  { slug: 'conversations', span: 'lg:col-span-2', stat: '6 channels' },
  { slug: 'quote-to-cash', span: 'lg:col-span-2', stat: 'Quote to paid' },
  { slug: 'support', span: 'lg:col-span-2', stat: 'SLA + CSAT' },
  { slug: 'analytics', span: 'lg:col-span-2', stat: 'Scheduled reports' },
  { slug: 'platform', span: 'lg:col-span-2', stat: 'Audit-ready' },
];

const TOUR: TourTab[] = [
  {
    id: 'ai',
    label: 'AI',
    icon: 'Sparkles',
    accent: 'from-fuchsia-500 to-violet-600',
    title: 'It writes the follow-up you keep postponing',
    body: 'The assistant reads the record — every email, call note, ticket and deal change — then drafts the next message in the tone you picked. Nothing sends without your approval.',
    points: [
      'Drafts built from real record context, not a blank template',
      'Lead scores and churn risk with the signals that produced them',
      'One-click summaries of a long thread before you jump on a call',
      'Bring your own provider key, with per-workspace credit budgets',
    ],
    href: '/features/ai',
    visual: <AiDraftMock />,
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: 'Zap',
    accent: 'from-amber-400 to-orange-500',
    title: 'Draw the process once, then stop thinking about it',
    body: 'A visual builder with real branching, conditions and delays. Deal marked won? Notify the channel, generate the invoice, create the onboarding tasks, all in the order you drew.',
    points: [
      'Conditions and branches on any field or computed value',
      'Sequences that exit automatically when someone replies',
      'Assignment rules with round-robin and load balancing',
      'Outbound events retry, log, and land in a queue you can replay',
    ],
    href: '/features/automation',
    visual: <AutomationMock />,
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'MessageSquare',
    accent: 'from-emerald-400 to-teal-500',
    title: 'Email, WhatsApp, SMS, chat and calls — one thread',
    body: 'Every message a customer ever sent, on the record it belongs to, whichever channel it arrived on. Support and sales finally read the same history.',
    points: [
      'Templates with merge fields across every channel',
      'Open and click tracking rolled into lead scoring',
      'Sending-domain warmup so volume outreach stays deliverable',
      'Embeddable forms and chat that create records instantly',
    ],
    href: '/features/conversations',
    visual: <ConversationMock />,
  },
  {
    id: 'revenue',
    label: 'Quote to cash',
    icon: 'Receipt',
    accent: 'from-cyan-400 to-blue-500',
    title: 'From “send me a quote” to money in the bank',
    body: 'Build the quote from your catalogue, send it as a public link, watch it get opened, collect the signature, raise the invoice — without leaving the deal.',
    points: [
      'Branded quote and invoice PDFs with tax and multi-currency',
      'Public accept and decline links, no customer login needed',
      'E-signature with a full signing event log',
      'Contracts, subscriptions and renewal reminders',
    ],
    href: '/features/quote-to-cash',
    visual: <QuoteMock />,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: 'BarChart3',
    accent: 'from-indigo-400 to-violet-500',
    title: 'Build the report once. Read it every Monday.',
    body: 'Pick the entity, the filters and the grouping. Save it, drop it on a dashboard, schedule it. Weekly reporting stops being a manual ritual.',
    points: [
      'Custom reports across every entity in the product',
      'Dashboards you arrange, with per-role visibility',
      'Weighted forecasting and conversion funnels',
      'Delivered as PDF or CSV on a schedule you set',
    ],
    href: '/features/analytics',
    visual: <AnalyticsMock />,
  },
];

export default function LandingPage() {
  const pillar = (slug: string) => PILLARS.find((p) => p.slug === slug)!;
  const builtIn = CONNECTORS.filter((c) => c.builtIn).slice(0, 16);

  return (
    <div className="mk-noise">
      {/* ══════════════════════════ HERO ══════════════════════════ */}
      <section className="relative overflow-hidden pt-28 sm:pt-36 mk-spotlight">
        <Aurora />
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <Link
                href="/features/ai"
                className="mk-chip group !border-violet-400/25 !bg-violet-500/10 !text-violet-200"
              >
                <span className="relative flex h-1.5 w-1.5 text-violet-400">
                  <span className="mk-ping absolute inset-0 rounded-full" />
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                </span>
                AI assistant, automation builder and billing — all included
                <Icon name="ArrowRight" className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Reveal>

            <Reveal delay={70}>
              <h1 className="mk-display mt-7">
                <span className="mk-grad">
                  <StaggerText text="Your whole revenue" wordDelay={70} />
                </span>
                <br />
                <span className="text-white">
                  <StaggerText text="operation. One place." wordDelay={70} startDelay={280} />
                </span>
              </h1>
            </Reveal>

            <Reveal delay={140}>
              <p className="mk-lead mx-auto mt-6 max-w-xl">
                NuCRM runs sales, support, billing and marketing on a single customer record — with an AI assistant, a
                visual automation builder and enterprise governance in the box. {BRAND.tagline}
              </p>
            </Reveal>

            <Reveal delay={210}>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <MagneticButton className="w-full sm:w-auto">
                  <PrimaryCta>Start free — no card</PrimaryCta>
                </MagneticButton>
                <MagneticButton className="w-full sm:w-auto">
                  <GhostCta href="/features">
                    See everything it does
                  </GhostCta>
                </MagneticButton>
              </div>
              <div className="mk-tiny mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                <span className="flex items-center gap-1.5">
                  <Icon name="Check" className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.6} /> Free plan forever
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="Check" className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.6} /> Set up in an
                  afternoon
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="Check" className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.6} /> Export your data any
                  time
                </span>
              </div>
            </Reveal>
          </div>

          {/* product shot */}
          <Reveal delay={280} className="relative mt-14 sm:mt-20">
            <div
              className="pointer-events-none absolute -inset-x-10 -top-10 bottom-10 -z-10 rounded-[40px] bg-gradient-to-b from-violet-600/25 via-indigo-600/10 to-transparent blur-3xl"
              aria-hidden
            />
            <div style={{ perspective: '2200px' }}>
              <div style={{ transform: 'rotateX(6deg)' }} className="origin-top">
                <AppPreview />
              </div>
            </div>
            {/* reflection fading into the page */}
            <div
              className="pointer-events-none mx-auto h-24 w-[92%] rounded-b-[40px] bg-gradient-to-b from-violet-500/10 to-transparent blur-2xl"
              aria-hidden
            />
          </Reveal>
        </Container>
      </section>

      {/* ═════════════════════ MODULE MARQUEE ═════════════════════ */}
      <div className="relative pb-4 pt-6">
        <Container>
          <p className="mk-tiny mb-5 text-center uppercase tracking-[0.16em]">
            {MODULES.length} modules · switch on what you need
          </p>
        </Container>
        <Marquee>
          {MODULES.map((m) => (
            <span
              key={m.id}
              className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5"
            >
              <Icon name={m.icon} className="h-4 w-4 text-violet-300" />
              <span className="whitespace-nowrap text-[13px] font-semibold text-slate-300">{m.name}</span>
            </span>
          ))}
        </Marquee>
      </div>

      {/* ══════════════════════ THE STACK ═════════════════════════ */}
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
              <span className="flex h-11 w-11 rotate-90 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/12 text-violet-300 lg:rotate-0">
                <Icon name="ArrowRight" className="h-5 w-5" strokeWidth={2.2} />
              </span>
            </div>

            {/* after */}
            <Reveal delay={120} className="mk-card mk-edge relative overflow-hidden p-6">
              <div
                className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl"
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
                <CheckList
                  items={[
                    'One customer record carrying every deal, ticket, quote, invoice and message',
                    'One permission model, so access rules apply everywhere at once',
                    'One audit trail that can answer who changed what, and when',
                    'One subscription, priced per user plus the modules you actually switch on',
                    'One place to look when a customer asks "where are we with this?"',
                  ]}
                />
                <div className="mt-6 flex flex-wrap gap-2">
                  <Chip icon="Zap">Nothing to integrate</Chip>
                  <Chip icon="ShieldCheck">Nothing to reconcile</Chip>
                  <Chip icon="Wallet">Nothing to renegotiate</Chip>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* ═══════════════════════ STATS ════════════════════════════ */}
      <Section id="scale" className="!py-14">
        <Container>
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
            {PLATFORM_STATS.map((s, i) => (
              <Reveal key={s.label} delay={i * 80} className="text-center">
                <div className="mk-h2 mk-grad-violet">
                  <AnimatedNumber target={s.value} suffix={s.suffix} />
                </div>
                <div className="mk-h4 mt-2 text-slate-200">{s.label}</div>
                <div className="mk-tiny mt-1">{s.sub}</div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ═════════════════════ BENTO CAPABILITIES ═════════════════ */}
      <Section id="features" tone="soft">
        <Container>
          <SectionHeading
            eyebrow="The platform"
            title="Eight jobs, one product"
            sub="Not a CRM with add-ons bolted on. Each area below is a first-class part of the same system, sharing the same records, permissions and history."
          />

          <div className="mt-14 grid gap-4 lg:grid-cols-6">
            {BENTO.map((b, i) => {
              const p = pillar(b.slug);
              const wide = b.span === 'lg:col-span-3';
              return (
                <Reveal key={b.slug} delay={i * 60} className={b.span}>
                  <TiltCard intensity={8} glare={wide}>
                    <Link
                      href={`/features/${p.slug}`}
                      className="mk-card mk-card-hover group relative flex h-full flex-col overflow-hidden p-6"
                    >
                      <div
                        className={`pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br ${p.accent} opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-25`}
                        aria-hidden
                      />
                      <div className="relative flex flex-1 flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <IconTile name={p.icon} accent={p.accent} size={wide ? 'lg' : 'md'} />
                          <span className="mk-mono rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[10px] text-slate-500">
                            {b.stat}
                          </span>
                        </div>
                        <h3 className={`${wide ? 'mk-h3' : 'mk-h4'} mt-5 text-white`}>{p.name}</h3>
                        <p className="mk-body mt-2 flex-1">{wide ? p.sub : p.blurb}</p>
                        {wide && (
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {p.highlights.slice(0, 3).map((h) => (
                              <span key={h.title} className="mk-chip !text-[11px]">
                                {h.title}
                              </span>
                            ))}
                          </div>
                        )}
                        <span className="mk-link mt-5 inline-flex items-center gap-1.5 text-[13px]">
                          Explore {softLower(p.short)}
                          <Icon
                            name="ArrowUpRight"
                            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                            strokeWidth={2.2}
                          />
                        </span>
                      </div>
                    </Link>
                  </TiltCard>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* ═══════════════════════ PRODUCT TOUR ═════════════════════ */}
      <Section id="tour">
        <Container>
          <SectionHeading
            eyebrow="Take a look"
            title="This is what the work actually looks like"
            sub="Five of the screens your team will live in. Every one of them is part of the same product, on the same record."
          />
          <div className="mt-14">
            <ProductTour tabs={TOUR} />
          </div>
        </Container>
      </Section>

      {/* ═════════════════════════ INDUSTRIES ═════════════════════ */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Industry blueprints"
            title="Configured before you log in"
            sub={`Choose your industry and NuCRM installs the pipelines, custom fields and automations that fit how that business actually sells. ${SOLUTIONS.length} blueprints, one click each.`}
          />

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SOLUTIONS.map((s, i) => (
              <Reveal key={s.slug} delay={(i % 3) * 60}>
                <Link
                  href={`/solutions/${s.slug}`}
                  className="mk-card mk-card-hover group flex h-full items-start gap-3.5 p-4"
                >
                  <IconTile name={s.icon} accent={s.accent} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="mk-h4 block text-white">{s.name}</span>
                    <span className="mk-small mt-1 block">{s.blurb}</span>
                    <span className="mk-mono mt-2.5 flex flex-wrap gap-1">
                      {s.pipelines[0]?.stages.slice(0, 3).map((st) => (
                        <span key={st} className="rounded border border-white/[0.07] bg-white/[0.03] px-1.5 py-[2px] text-[9.5px] text-slate-500">
                          {st}
                        </span>
                      ))}
                      <span className="px-1 py-[2px] text-[9.5px] text-slate-600">
                        +{Math.max(0, (s.pipelines[0]?.stages.length ?? 0) - 3)}
                      </span>
                    </span>
                  </span>
                  <Icon
                    name="ArrowUpRight"
                    className="h-4 w-4 shrink-0 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-violet-300"
                  />
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ════════════════════════ INTEGRATIONS ════════════════════ */}
      <Section id="integrations">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <Eyebrow className="mb-4">Integrations</Eyebrow>
              <h2 className="mk-h2 text-white">
                “Does it integrate with…” <span className="mk-grad-violet">yes</span>
              </h2>
              <p className="mk-lead mt-4">
                First-party connectors for the tools most teams already run, and an integration engine for everything
                else: give it a base URL and a key, and it works out the request patterns for you.
              </p>
              <CheckList
                className="mt-6"
                items={[
                  'Built-in connectors for email delivery, mailbox sync, messaging, chat-ops, payments, calendar and identity',
                  'Connect almost any other API from a workflow action — no waiting for us to build a logo tile',
                  'Outbound webhooks with retries, delivery logs and a replayable dead-letter queue',
                  'A documented REST API covering every entity, plus OAuth apps and a module SDK',
                ]}
              />
              <div className="mt-7 flex flex-wrap gap-2.5">
                <GhostCta href="/integrations">Browse integrations</GhostCta>
                <Link href="/integrations#api" className="mk-btn mk-btn-ghost">
                  Developer API
                </Link>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="relative">
                <div
                  className="pointer-events-none absolute inset-0 -z-10 rounded-[32px] bg-gradient-to-br from-violet-600/20 to-cyan-500/10 blur-3xl"
                  aria-hidden
                />
                <div className="grid grid-cols-4 gap-2.5">
                  {builtIn.map((c) => (
                    <div
                      key={c.name}
                      title={c.what}
                      className="mk-card mk-card-hover flex aspect-square flex-col items-center justify-center gap-2 p-2 text-center"
                    >
                      <Icon name={c.icon} className="h-5 w-5 text-slate-300" />
                      <span className="text-[10px] font-semibold leading-tight text-slate-500">{c.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* ══════════════════════════ SECURITY ═════════════════════ */}
      <Section tone="soft">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
            <Reveal>
              <Eyebrow className="mb-4">Trust</Eyebrow>
              <h2 className="mk-h2 text-white">Built for the person who has to sign it off</h2>
              <p className="mk-lead mt-4">
                Workspace data is separated beneath the application, not merely filtered in the interface. Permissions go
                down to the field. Every change is recorded. Backups have been restored, not just scheduled.
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {[
                  { t: 'Isolation you can point at', d: 'Separation enforced at the data layer', i: 'Layers' },
                  { t: 'Access control that goes deep', d: 'Custom roles, record and field rules', i: 'KeyRound' },
                  { t: 'SSO and 2FA', d: 'SAML, OpenID Connect, TOTP, IP rules', i: 'Fingerprint' },
                  { t: 'Provable history', d: 'Audit log plus field-level diffs', i: 'ScrollText' },
                  { t: 'GDPR handled in product', d: 'Access, erasure, portability, retention', i: 'Scale' },
                  { t: 'Recoverable by design', d: 'Backups, selective restore, trash, undo', i: 'DatabaseBackup' },
                ].map((f) => (
                  <div key={f.t} className="flex gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-500/10">
                      <Icon name={f.i} className="h-4 w-4 text-emerald-300" />
                    </span>
                    <span>
                      <span className="block text-[13.5px] font-semibold text-slate-200">{f.t}</span>
                      <span className="mk-tiny mt-0.5 block">{f.d}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-7">
                <GhostCta href="/security">How we protect your data</GhostCta>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="mk-card mk-edge relative overflow-hidden p-7">
                <div
                  className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-emerald-500/15 blur-3xl"
                  aria-hidden
                />
                <div className="relative">
                  <div className="mk-eyebrow text-emerald-300/90">Security review, answered</div>
                  <dl className="mt-5 divide-y divide-white/[0.07]">
                    {[
                      ['Who can see our data?', 'Only users you invite. Support access needs a logged, time-bound session.'],
                      ['Can we export everything?', 'Yes, any time, by entity or as a full workspace export.'],
                      ['Do you train models on it?', 'No. And you can supply your own AI provider key.'],
                      ['Can we self-host?', 'Private deployment is available under an Enterprise agreement.'],
                      ['Where does it live?', 'Cloud by default, with regional options on Enterprise.'],
                    ].map(([q, a]) => (
                      <div key={q} className="py-3.5">
                        <dt className="text-[13.5px] font-semibold text-slate-200">{q}</dt>
                        <dd className="mk-small mt-1">{a}</dd>
                      </div>
                    ))}
                  </dl>
                  <TextLink href="/security">Read the full security overview</TextLink>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* ═══════════════════════ COMPARE TEASER ═══════════════════ */}
      <Section id="compare">
        <Container>
          <SectionHeading
            eyebrow="Compare"
            title="Honestly, next to the alternatives"
            sub="Every tool on this list is good at something. Here is where the packaging differs — and we say plainly where a competitor is the better choice."
          />

          <Reveal delay={80} className="mk-card mt-12 overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="mk-table min-w-[860px]">
                <thead>
                  <tr>
                    <th className="w-[30%]">Capability</th>
                    <th className="mk-col-own text-center">NuCRM</th>
                    <th className="text-center">HubSpot</th>
                    <th className="text-center">Salesforce</th>
                    <th className="text-center">Pipedrive</th>
                    <th className="text-center">Zoho</th>
                    <th className="text-center">monday</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_OVERVIEW.map((r) => (
                    <tr key={r.label}>
                      <td className="text-slate-300">{r.label}</td>
                      <td className="mk-col-own text-center">
                        <MatrixValue value={r.nucrm} own />
                      </td>
                      <td className="text-center">
                        <MatrixValue value={r.hubspot} />
                      </td>
                      <td className="text-center">
                        <MatrixValue value={r.salesforce} />
                      </td>
                      <td className="text-center">
                        <MatrixValue value={r.pipedrive} />
                      </td>
                      <td className="text-center">
                        <MatrixValue value={r.zoho} />
                      </td>
                      <td className="text-center">
                        <MatrixValue value={r.monday} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>

          <Reveal delay={140} className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            {[
              ['HubSpot', 'hubspot'],
              ['Salesforce', 'salesforce'],
              ['Pipedrive', 'pipedrive'],
              ['Zoho CRM', 'zoho'],
              ['monday CRM', 'monday'],
            ].map(([label, slug]) => (
              <Link key={slug} href={`/compare/${slug}`} className="mk-chip hover:!border-violet-400/30 hover:!text-white">
                NuCRM vs {label}
                <Icon name="ArrowUpRight" className="h-3 w-3" />
              </Link>
            ))}
          </Reveal>
        </Container>
      </Section>

      {/* ═══════════════════════════ PRICING ═════════════════════ */}
      <Section id="pricing" tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title="Per user, plus the modules you switch on"
            sub="No contact bands, no marketing-tier maths, no negotiating for a feature you assumed was included. Start free and stay there as long as it works."
          />

          <div className="mt-14 grid gap-4 lg:grid-cols-4">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.id} delay={i * 70}>
                <div
                  className={`relative flex h-full flex-col rounded-2xl border p-6 ${
                    plan.featured
                      ? 'mk-edge mk-glow border-violet-400/30 bg-gradient-to-b from-violet-600/[0.14] to-white/[0.02]'
                      : 'border-white/[0.08] bg-white/[0.025]'
                  }`}
                >
                  {plan.featured && (
                    <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-white shadow-lg shadow-violet-500/30">
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

          <Reveal delay={120} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <GhostCta href="/pricing">Full plan comparison</GhostCta>
            <GhostCta href="/modules">See all {MODULES.length} modules</GhostCta>
          </Reveal>
        </Container>
      </Section>

      {/* ═════════════════════════════ FAQ ═══════════════════════ */}
      <Section id="faq">
        <Container>
          <SectionHeading eyebrow="Questions" title="The things people ask before signing up" />
          <div className="mt-12">
            <Faq items={PRICING_FAQ} />
          </div>
        </Container>
      </Section>

      <CtaBand />
    </div>
  );
}
