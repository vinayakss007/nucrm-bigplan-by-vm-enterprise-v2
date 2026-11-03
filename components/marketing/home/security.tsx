/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { Container, Eyebrow, GhostCta, Section, TextLink } from '@/components/marketing/ui';
import { SECURITY_POINTS, SECURITY_QA } from '@/lib/marketing/home';

/** The trust panel: what an operator has to sign off, and the five questions. */
export function HomeSecurity() {
  return (
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
              {SECURITY_POINTS.map((f) => (
                <div key={f.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-500/10">
                    <Icon name={f.icon} className="h-4 w-4 text-emerald-300" />
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-semibold text-slate-200">{f.title}</span>
                    <span className="mk-tiny mt-0.5 block">{f.body}</span>
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
                  {SECURITY_QA.map(([q, a]) => (
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
  );
}
