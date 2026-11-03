/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { Container, MatrixValue, Section, SectionHeading } from '@/components/marketing/ui';
import { COMPARE_OVERVIEW } from '@/lib/marketing/compare';
import { COMPARE_TEASER_LINKS } from '@/lib/marketing/home';

/** #compare — the capability matrix teaser and the links to each full page. */
export function HomeCompareTeaser() {
  return (
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
          {COMPARE_TEASER_LINKS.map(([label, slug]) => (
            <Link key={slug} href={`/compare/${slug}`} className="mk-chip hover:!border-sky-400/30 hover:!text-white">
              NuCRM vs {label}
              <Icon name="ArrowUpRight" className="h-3 w-3" />
            </Link>
          ))}
        </Reveal>
      </Container>
    </Section>
  );
}
