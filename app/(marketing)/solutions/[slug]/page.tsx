import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SOLUTIONS, getSolution } from '@/lib/marketing/solutions';
import { MODULES } from '@/lib/marketing/modules';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
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
  TextLink,
} from '@/components/marketing/ui';

export function generateStaticParams() {
  return SOLUTIONS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = getSolution(slug);
  if (!s) return {};
  return {
    title: `${s.name} CRM — ${s.headline}`,
    description: `${s.sub} NuCRM installs the ${s.pipelines.map((p) => p.name).join(' and ')} pipeline${
      s.pipelines.length > 1 ? 's' : ''
    } with the custom fields and automations ${s.name.toLowerCase()} teams need.`,
    alternates: { canonical: `/solutions/${s.slug}` },
    openGraph: { title: `NuCRM for ${s.name}`, description: s.sub },
  };
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getSolution(slug);
  if (!s) notFound();

  const modules = s.modules
    .map((name) => MODULES.find((m) => m.name === name || m.name.startsWith(name)))
    .filter((m): m is (typeof MODULES)[number] => Boolean(m));
  const others = SOLUTIONS.filter((o) => o.slug !== s.slug).slice(0, 6);

  return (
    <>
      <PageHero
        eyebrow={`NuCRM for ${s.name.toLowerCase()}`}
        title={s.headline}
        sub={s.sub}
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Solutions', href: '/solutions' },
          { label: s.name, href: `/solutions/${s.slug}` },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free with this blueprint</PrimaryCta>
          <GhostCta href="/contact">Talk to someone who knows the sector</GhostCta>
        </div>
      </PageHero>

      {/* problems */}
      <Section className="!pt-6">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <Reveal>
              <SectionHeading
                align="left"
                eyebrow="Sound familiar?"
                title={`What usually goes wrong in ${s.name.toLowerCase()}`}
              />
              <p className="mk-body mt-5">
                These are the failure modes a general-purpose CRM leaves in place, because it has no opinion about how
                your business works.
              </p>
              <div className="mt-6">
                <TextLink href="/features">See how the platform addresses each one</TextLink>
              </div>
            </Reveal>
            <div className="space-y-3">
              {s.problems.map((p, i) => (
                <Reveal key={p} delay={i * 70} className="mk-card flex gap-3.5 p-4">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-400/20 bg-rose-500/10">
                    <Icon name="AlertTriangle" className="h-4 w-4 text-rose-300" />
                  </span>
                  <span className="mk-body text-slate-300">{p}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* what installs */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="The blueprint"
            title="Exactly what gets installed"
            sub="No mystery configuration. This is the literal content of the blueprint, and every part of it is yours to rename or remove."
          />

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {/* pipelines */}
            <Reveal className="mk-card p-6 lg:col-span-2">
              <div className="flex items-center gap-2.5">
                <IconTile name="Kanban" accent={s.accent} size="sm" />
                <h3 className="mk-h4 text-white">
                  {s.pipelines.length} pipeline{s.pipelines.length > 1 ? 's' : ''}
                </h3>
              </div>
              <div className="mt-5 space-y-6">
                {s.pipelines.map((p) => (
                  <div key={p.name}>
                    <div className="mk-tiny mb-2.5 uppercase tracking-wider text-slate-500">{p.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.stages.map((st, i) => (
                        <span key={st} className="flex items-center gap-1.5">
                          {i > 0 && <Icon name="ChevronRight" className="h-3 w-3 text-slate-700" />}
                          <span className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-slate-300">
                            {st}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            {/* automations */}
            <Reveal delay={80} className="mk-card p-6">
              <div className="flex items-center gap-2.5">
                <IconTile name="Zap" accent="from-amber-400 to-orange-500" size="sm" />
                <h3 className="mk-h4 text-white">Automations</h3>
              </div>
              <ul className="mt-5 space-y-2.5">
                {s.automations.map((a) => (
                  <li key={a} className="flex gap-2.5">
                    <Icon name="Check" className="mt-[3px] h-4 w-4 shrink-0 text-amber-300" strokeWidth={2.4} />
                    <span className="text-[13.5px] leading-relaxed text-slate-300">{a}</span>
                  </li>
                ))}
              </ul>
              <p className="mk-tiny mt-4 border-t border-white/[0.07] pt-4">
                Switched on and running from the moment the blueprint installs. Add your own in the visual builder.
              </p>
            </Reveal>

            {/* fields */}
            <Reveal delay={120} className="mk-card p-6 lg:col-span-3">
              <div className="flex items-center gap-2.5">
                <IconTile name="SlidersHorizontal" accent="from-cyan-400 to-blue-500" size="sm" />
                <h3 className="mk-h4 text-white">Custom fields</h3>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {s.fields.map((f) => (
                  <span
                    key={f.entity + f.label}
                    className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2"
                  >
                    <span className="mk-mono rounded bg-white/[0.06] px-1.5 py-[1px] text-[9.5px] uppercase text-slate-500">
                      {f.entity}
                    </span>
                    <span className="text-[13px] font-medium text-slate-300">{f.label}</span>
                  </span>
                ))}
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* screen */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="Day one"
            title="This is what your team opens on Monday"
            sub="Your pipeline, your fields, your automations — inside the same product that also handles support, invoicing and reporting when you need them."
          />
          <Reveal delay={100} className="relative mt-12">
            <div
              className={`pointer-events-none absolute -inset-6 -z-10 rounded-[36px] bg-gradient-to-br ${s.accent} opacity-[0.14] blur-3xl`}
              aria-hidden
            />
            <AppPreview />
          </Reveal>
        </Container>
      </Section>

      {/* modules + product */}
      <Section tone="soft">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <SectionHeading align="left" eyebrow="Recommended modules" title="What most teams in this sector add" />
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {modules.map((m, i) => (
                  <Reveal key={m.id} delay={i * 60}>
                    <Link href="/modules" className="mk-card mk-card-hover group flex h-full flex-col p-4">
                      <div className="flex items-start justify-between gap-2">
                        <IconTile name={m.icon} accent={m.accent} size="sm" />
                        <span className="mk-mono text-[10.5px] text-slate-500">
                          {m.addOn === 0 ? 'Included' : `+$${m.addOn}/mo`}
                        </span>
                      </div>
                      <span className="mk-h4 mt-3.5 text-white">{m.name}</span>
                      <span className="mk-small mt-1.5 flex-1">{m.summary}</span>
                    </Link>
                  </Reveal>
                ))}
              </div>
            </div>

            <div>
              {s.product && (
                <Reveal className="mk-card mk-edge relative overflow-hidden p-6">
                  <div
                    className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-violet-500/20 blur-3xl"
                    aria-hidden
                  />
                  <div className="relative">
                    <div className="mk-eyebrow text-violet-300/90">Also by abetworks</div>
                    <h3 className="mk-h3 mt-3 text-white">{s.product.name}</h3>
                    <p className="mk-body mt-2.5">
                      A focused product built on the same platform, with a workspace shaped entirely around this way of
                      working — and the full CRM underneath it whenever you need more.
                    </p>
                    <div className="mt-5">
                      <GhostCta href={`/abetworks/${s.product.slug}`}>Look at {s.product.name}</GhostCta>
                    </div>
                  </div>
                </Reveal>
              )}

              <Reveal delay={80} className={s.product ? 'mt-4' : ''}>
                <div className="mk-card p-6">
                  <h3 className="mk-h4 text-white">Other industries</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {others.map((o) => (
                      <Link
                        key={o.slug}
                        href={`/solutions/${o.slug}`}
                        className="mk-chip hover:!border-violet-400/30 hover:!text-white"
                      >
                        <Icon name={o.icon} className="h-3.5 w-3.5 text-violet-300" />
                        {o.name}
                      </Link>
                    ))}
                  </div>
                  <div className="mt-5">
                    <TextLink href="/solutions">All {SOLUTIONS.length} blueprints</TextLink>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </Section>

      <CtaBand
        title={`Set up your ${s.name.toLowerCase()} workspace today`}
        sub="Start free, install the blueprint, import your contacts. If it does not fit, every part of it is yours to change."
      />
    </>
  );
}
