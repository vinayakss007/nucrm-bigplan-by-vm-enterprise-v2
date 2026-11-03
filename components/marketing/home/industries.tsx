/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconTile, Section, SectionHeading } from '@/components/marketing/ui';
import { SOLUTIONS } from '@/lib/marketing/solutions';

/** Industry blueprints — one card per pre-configured vertical. */
export function HomeIndustries() {
  return (
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
                      <span key={st} className="rounded border border-white/[0.07] bg-white/[0.03] px-1.5 py-[2px] text-[10.5px] text-slate-500">
                        {st}
                      </span>
                    ))}
                    <span className="px-1 py-[2px] text-[10.5px] text-slate-600">
                      +{Math.max(0, (s.pipelines[0]?.stages.length ?? 0) - 3)}
                    </span>
                  </span>
                </span>
                <Icon
                  name="ArrowUpRight"
                  className="h-4 w-4 shrink-0 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-sky-300"
                />
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
