/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import { API_POINTS, CONNECTORS, CONNECTOR_CATEGORIES, ENGINE_POINTS } from '@/lib/marketing/integrations';
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
  SectionHeading,
} from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'Integrations & developer API',
  description:
    'First-party connectors for email, messaging, chat-ops, payments, calendar and identity — plus an integration engine that connects almost any API with a base URL and a key, and a full REST API.',
  alternates: { canonical: '/integrations' },
};

export default function IntegrationsPage() {
  return (
    <>
      <PageHero
        eyebrow="Integrations"
        title={
          <>
            “Does it integrate with…” <span className="mk-grad-violet">almost certainly yes</span>
          </>
        }
        sub="Built-in connectors for the tools most teams already run, an integration engine for everything else, and a documented API covering every entity in the product."
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Integrations', href: '/integrations' },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryCta>Start free</PrimaryCta>
          <GhostCta href="#api">Developer API</GhostCta>
        </div>
      </PageHero>

      {/* connectors by category */}
      <Section className="!pt-6">
        <Container>
          <SectionHeading
            eyebrow="Built in"
            title="Connectors that ship with the product"
            sub="No marketplace hunt, no third-party middleware subscription, no per-task pricing on a connector platform."
          />

          <div className="mt-14 space-y-8">
            {CONNECTOR_CATEGORIES.map((category, ci) => {
              const items = CONNECTORS.filter((c) => c.category === category);
              if (items.length === 0) return null;
              return (
                <Reveal key={category} delay={ci * 40}>
                  <div className="mk-card overflow-hidden !p-0">
                    <div className="flex items-center gap-3 border-b border-white/[0.07] bg-white/[0.02] px-5 py-3.5">
                      <h3 className="mk-h4 text-white">{category}</h3>
                      <span className="mk-mono ml-auto text-[11px] text-slate-600">{items.length}</span>
                    </div>
                    <div className="grid gap-px bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((c) => (
                        <div key={c.name} className="flex items-start gap-3 bg-[#0b0b16] p-4">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                            <Icon name={c.icon} className="h-4 w-4 text-slate-300" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-semibold text-slate-200">{c.name}</span>
                            <span className="mk-small mt-0.5 block">{c.what}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* the engine */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="The integration engine"
            title="For the tool nobody has built a connector for"
            sub="Point the engine at an API, give it credentials, and it works out the request patterns — so “is it on your integrations page?” stops being the question that decides your purchase."
          />

          <div className="mt-14 grid gap-4 sm:grid-cols-2">
            {ENGINE_POINTS.map((p, i) => (
              <Reveal key={p.title} delay={(i % 2) * 70} className="mk-card mk-card-hover p-6">
                <IconTile name={p.icon} accent="from-cyan-400 to-blue-500" />
                <h3 className="mk-h4 mt-4 text-white">{p.title}</h3>
                <p className="mk-body mt-2">{p.body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* api */}
      <Section id="api">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr]">
            <Reveal>
              <SectionHeading align="left" eyebrow="Developer API" title="Everything in the interface, over the API" />
              <p className="mk-body mt-5">
                If a person can do it in NuCRM, a program can do it too. That includes reading and writing every entity,
                managing users and roles, driving automations and subscribing to events.
              </p>
              <ul className="mt-6 space-y-2.5">
                {API_POINTS.map((p) => (
                  <li key={p} className="flex gap-3">
                    <Icon name="Check" className="mt-[3px] h-4 w-4 shrink-0 text-sky-400" strokeWidth={2.4} />
                    <span className="mk-body text-slate-300">{p}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <GhostCta href="/contact">Ask an integration question</GhostCta>
              </div>
            </Reveal>

            {/* illustrative request/response, not tied to any internal detail */}
            <Reveal delay={100}>
              <div className="mk-card mk-edge overflow-hidden !p-0">
                <div className="flex items-center gap-2 border-b border-white/[0.07] bg-white/[0.03] px-4 py-2.5">
                  <span className="mk-mono rounded bg-emerald-500/15 px-1.5 py-[1px] text-[10px] font-bold text-emerald-300">
                    POST
                  </span>
                  <span className="mk-mono text-slate-400">/api/v2/deals</span>
                  <span className="mk-mono ml-auto text-[10px] text-slate-600">201 Created</span>
                </div>
                <pre className="mk-mono overflow-x-auto p-4 !text-[11.5px] leading-relaxed text-slate-400">
                  <code>{`{
  "title": "Meridian Health — Q3 rollout",
  "pipeline": "enterprise",
  "stage": "proposal",
  "value": 74000,
  "currency": "USD",
  "company_id": "cmp_8f21a",
  "owner": "a.kaur@acme.com",
  "custom_fields": {
    "treatment_type": "clinic group"
  }
}`}</code>
                </pre>
                <div className="border-t border-white/[0.07] bg-white/[0.02] px-4 py-3">
                  <div className="mk-tiny mb-2 uppercase tracking-wider">Triggers, automatically</div>
                  <div className="flex flex-wrap gap-1.5">
                    {['deal.created', 'assignment rules', 'workflow: proposal sent', 'webhook delivery', 'audit entry'].map(
                      (t) => (
                        <span key={t} className="mk-chip !text-[11px]">
                          {t}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              </div>
              <p className="mk-tiny mt-3">
                Illustrative request. The interactive reference in your workspace always reflects the live schema.
              </p>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* reliability of integrations */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="When things break"
            title="Integrations that fail loudly, then recover"
            sub="The worst integration is the one that stopped working three weeks ago and nobody noticed."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              { t: 'Every attempt logged', d: 'Status, timing and payload for each delivery, inspectable in the workspace.', i: 'Activity' },
              { t: 'Automatic retries', d: 'Exponential backoff, so a partner’s brief outage resolves itself.', i: 'RefreshCw' },
              { t: 'Dead-letter queue', d: 'Anything that exhausts its retries lands in a queue you can inspect and replay.', i: 'ArrowDownToLine' },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 70} className="mk-card p-6">
                <IconTile name={c.i} accent="from-amber-400 to-orange-500" size="sm" />
                <h3 className="mk-h4 mt-4 text-white">{c.t}</h3>
                <p className="mk-body mt-2">{c.d}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <CtaBand
        title="Connect your stack and see it working"
        sub="Start free, add a connector, and watch the delivery log fill up. Everything is inspectable from day one."
      />
    </>
  );
}
