/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BRAND } from '@/lib/marketing/site';
import { Icon } from './icon';
import { Container, PageHero, Section } from './ui';

/**
 * Shared shell for legal pages: hero, sticky section index, prose column.
 *
 * NOTE FOR WHOEVER LAUNCHES THIS: the copy on the legal pages is written to be
 * accurate about how the product actually behaves, but it has not been reviewed
 * by a lawyer and it is not tailored to your jurisdiction, entity name or
 * registered address. Have counsel review it, and fill in the placeholders in
 * lib/marketing/site.ts (contact addresses) before publishing.
 */
export function LegalShell({
  eyebrow,
  title,
  sub,
  updated,
  sections,
  children,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  /** ISO date, rendered as a readable "last updated". */
  updated: string;
  sections: { id: string; label: string }[];
  children: ReactNode;
}) {
  const date = new Date(updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <PageHero
        eyebrow={eyebrow}
        title={title}
        sub={sub}
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Legal', href: '/legal/privacy' },
          { label: eyebrow, href: '#' },
        ]}
      >
        <div className="mk-tiny mt-6 flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Icon name="CalendarDays" className="h-3.5 w-3.5" />
            Last updated {date}
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="Mail" className="h-3.5 w-3.5" />
            Questions: <a href={`mailto:${BRAND.email}`} className="mk-link">{BRAND.email}</a>
          </span>
        </div>
      </PageHero>

      <Section className="!pt-4">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
            {/* index */}
            <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
              <div className="mk-eyebrow mb-3 text-slate-500">On this page</div>
              <ul className="space-y-0.5">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="block rounded-lg px-2.5 py-1.5 text-[13px] text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-sky-300"
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-6 space-y-1 border-t border-white/[0.07] pt-5">
                {(
                  [
                    ['Privacy policy', '/legal/privacy'],
                    ['Terms of service', '/legal/terms'],
                    ['Data processing', '/legal/dpa'],
                    ['Security overview', '/security'],
                  ] as const
                ).map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    className="block rounded-lg px-2.5 py-1.5 text-[13px] text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-sky-300"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </nav>

            {/* body */}
            <div className="mk-prose max-w-3xl">{children}</div>
          </div>
        </Container>
      </Section>
    </>
  );
}
