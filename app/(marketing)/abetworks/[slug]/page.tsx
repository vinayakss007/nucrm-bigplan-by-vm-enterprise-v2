import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { STUDIO_PRODUCTS, getStudioProduct } from '@/lib/marketing/abetworks';
import { MODULES } from '@/lib/marketing/modules';
import { getSolution } from '@/lib/marketing/solutions';
import { softLower } from '@/lib/marketing/text';
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
  return STUDIO_PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = getStudioProduct(slug);
  if (!p) return {};
  return {
    title: `${p.name} by abetworks — ${p.headline}`,
    description: `${p.hook} ${p.sub}`,
    alternates: { canonical: `/abetworks/${p.slug}` },
    openGraph: { title: `${p.name} by abetworks`, description: p.hook },
  };
}

export default async function StudioProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = getStudioProduct(slug);
  if (!p) notFound();

  const modules = p.modules
    .map((name) => MODULES.find((m) => m.name === name || m.name.startsWith(name)))
    .filter((m): m is (typeof MODULES)[number] => Boolean(m));
  const solution = p.solution ? getSolution(p.solution) : undefined;
  const others = STUDIO_PRODUCTS.filter((o) => o.slug !== p.slug);

  return (
    <>
      <PageHero
        eyebrow={`${p.name} · by abetworks`}
        title={p.headline}
        sub={p.sub}
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'abetworks', href: '/abetworks' },
          { label: p.name, href: `/abetworks/${p.slug}` },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free</PrimaryCta>
          <GhostCta href="/contact">Ask about {p.name}</GhostCta>
        </div>
      </PageHero>

      {/* dashboard metrics */}
      <Section className="!pt-6">
        <Container>
          <Reveal>
            <div className="mk-card mk-edge relative overflow-hidden p-7">
              <div
                className={`pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gradient-to-br ${p.accent} opacity-20 blur-3xl`}
                aria-hidden
              />
              <div className="relative">
                <div className="flex items-center gap-3">
                  <IconTile name={p.icon} accent={p.accent} size="lg" />
                  <div>
                    <div className="mk-eyebrow text-violet-300/90">The dashboard you land on</div>
                    <h2 className="mk-h3 mt-2 text-white">Four numbers that actually matter here</h2>
                  </div>
                </div>
                <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {p.dashboard.map((d) => (
                    <div key={d} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                      <div className="mk-tiny uppercase tracking-wider">{d}</div>
                      <div className="mt-2 h-1 w-10 rounded-full bg-gradient-to-r from-violet-400 to-cyan-400" />
                    </div>
                  ))}
                </div>
                <p className="mk-small mt-5">
                  Not a generic CRM dashboard with widgets you have to choose. This product opens on the metrics that
                  matter for this kind of business, and nothing else competes for the space.
                </p>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* workspace + actions */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="The workspace"
            title="A focused product, a full platform underneath"
            sub="The navigation contains what this job needs and nothing it does not. When you need the rest of NuCRM — support tickets, invoicing, reporting, automation — it is already there on the same records."
          />

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            <Reveal className="mk-card p-6">
              <div className="flex items-center gap-2.5">
                <IconTile name="LayoutDashboard" accent={p.accent} size="sm" />
                <h3 className="mk-h4 text-white">Navigation</h3>
              </div>
              <ul className="mt-5 space-y-1.5">
                {p.workspace.map((w, i) => (
                  <li
                    key={w}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] ${
                      i === 0
                        ? 'bg-violet-500/12 font-semibold text-violet-200 ring-1 ring-inset ring-violet-400/20'
                        : 'text-slate-400'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
                    {w}
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={80} className="mk-card p-6">
              <div className="flex items-center gap-2.5">
                <IconTile name="Zap" accent="from-amber-400 to-orange-500" size="sm" />
                <h3 className="mk-h4 text-white">One-click actions</h3>
              </div>
              <ul className="mt-5 space-y-2.5">
                {p.quickActions.map((a) => (
                  <li key={a} className="flex items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
                    <Icon name="ArrowRight" className="h-3.5 w-3.5 shrink-0 text-amber-300" strokeWidth={2.2} />
                    <span className="text-[13.5px] font-medium text-slate-300">{a}</span>
                  </li>
                ))}
              </ul>
              <p className="mk-tiny mt-4 border-t border-white/[0.07] pt-4">
                Available from anywhere, including the command palette.
              </p>
            </Reveal>

            <Reveal delay={120} className="mk-card p-6">
              <div className="flex items-center gap-2.5">
                <IconTile name="Kanban" accent="from-cyan-400 to-blue-500" size="sm" />
                <h3 className="mk-h4 text-white">{p.pipeline.name}</h3>
              </div>
              <div className="mt-5 space-y-1.5">
                {p.pipeline.stages.map((s, i) => (
                  <div key={s} className="flex items-center gap-2.5">
                    <span className="mk-mono w-5 shrink-0 text-[10px] text-slate-600">{String(i + 1).padStart(2, '0')}</span>
                    <span className="flex-1 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[13px] font-medium text-slate-300">
                      {s}
                    </span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* who it is for */}
      <Section>
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <Reveal>
              <SectionHeading align="left" eyebrow="Who it is for" title={`${p.name} suits you if…`} />
              <p className="mk-body mt-5">
                If none of these describe you, one of the other products in the family probably fits better — or plain
                NuCRM, which contains all of them.
              </p>
              <div className="mt-6">
                <TextLink href="/abetworks#products">See the whole family</TextLink>
              </div>
            </Reveal>
            <div className="space-y-3">
              {p.whoFor.map((w, i) => (
                <Reveal key={w} delay={i * 70} className="mk-card flex items-center gap-4 p-5">
                  <Icon name="Check" className="h-5 w-5 shrink-0 text-emerald-400" strokeWidth={2.4} />
                  <span className="mk-h4 text-slate-200">{w}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* screen */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Underneath"
            title="The same platform your business will grow into"
            sub="Every one of these products writes to the NuCRM customer record. Outgrowing the focused view means switching a module on, not migrating to a different product."
          />
          <Reveal delay={100} className="relative mt-12">
            <div
              className={`pointer-events-none absolute -inset-6 -z-10 rounded-[36px] bg-gradient-to-br ${p.accent} opacity-[0.14] blur-3xl`}
              aria-hidden
            />
            <AppPreview />
          </Reveal>
        </Container>
      </Section>

      {/* modules + industry */}
      <Section>
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <SectionHeading align="left" eyebrow="Built from" title="The modules behind this product" />
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

            <div className="space-y-4">
              {solution && (
                <Reveal className="mk-card p-6">
                  <div className="mk-eyebrow text-violet-300/90">Industry blueprint</div>
                  <h3 className="mk-h3 mt-3 text-white">{solution.name}</h3>
                  <p className="mk-body mt-2.5">
                    This product ships with the {softLower(solution.name)} blueprint: {solution.pipelines.length}{' '}
                    pipeline{solution.pipelines.length > 1 ? 's' : ''}, {solution.fields.length} custom fields and{' '}
                    {solution.automations.length} automation{solution.automations.length === 1 ? '' : 's'}, installed for
                    you.
                  </p>
                  <div className="mt-5">
                    <GhostCta href={`/solutions/${solution.slug}`}>See exactly what installs</GhostCta>
                  </div>
                </Reveal>
              )}

              <Reveal delay={80} className="mk-card p-6">
                <h3 className="mk-h4 text-white">Other products by abetworks</h3>
                <div className="mt-4 space-y-1.5">
                  {others.map((o) => (
                    <Link
                      key={o.slug}
                      href={`/abetworks/${o.slug}`}
                      className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${o.accent} ring-1 ring-inset ring-white/20`}
                      >
                        <Icon name={o.icon} className="h-3 w-3 text-white" />
                      </span>
                      <span className="flex-1 text-[13px] font-medium text-slate-400 group-hover:text-white">
                        {o.name}
                      </span>
                      <Icon name="ArrowUpRight" className="h-3.5 w-3.5 text-slate-700 group-hover:text-violet-300" />
                    </Link>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </Section>

      <CtaBand
        title={`Start with ${p.name}, grow into the platform`}
        sub="Free to start. Nothing to migrate later — the focused product and the full platform are the same system."
      />
    </>
  );
}
