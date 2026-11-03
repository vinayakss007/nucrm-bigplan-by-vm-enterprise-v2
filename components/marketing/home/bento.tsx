/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import { Icon } from '@/components/marketing/icon';
import { Reveal, TiltCard } from '@/components/marketing/reveal';
import { Container, IconTile, Section, SectionHeading } from '@/components/marketing/ui';
import { PILLARS } from '@/lib/marketing/features';
import { BENTO } from '@/lib/marketing/home';
import { softLower } from '@/lib/marketing/text';

/** #features — the eight capability tiles, two wide and six filling the grid. */
export function HomeBento() {
  return (
    <Section id="features" tone="soft">
      <Container>
        <SectionHeading
          eyebrow="The platform"
          title="Eight jobs, one product"
          sub="Not a CRM with add-ons bolted on. Each area below is a first-class part of the same system, sharing the same records, permissions and history."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {BENTO.map((b, i) => {
            const p = PILLARS.find((x) => x.slug === b.slug)!;
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
                        <span className="mk-mono rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[10.5px] text-slate-500">
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
  );
}
