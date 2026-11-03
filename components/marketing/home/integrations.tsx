/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { CheckList, Container, Eyebrow, GhostCta, Section } from '@/components/marketing/ui';
import { CONNECTORS } from '@/lib/marketing/integrations';
import { INTEGRATION_BULLETS } from '@/lib/marketing/home';
import { connectorTint } from '@/lib/marketing/tints';

/** #integrations — the pitch on the left, the first-party connector wall on the right. */
export function HomeIntegrations() {
  const builtIn = CONNECTORS.filter((c) => c.builtIn).slice(0, 16);

  return (
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
            <CheckList className="mt-6" items={INTEGRATION_BULLETS} />
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
                className="pointer-events-none absolute inset-0 -z-10 rounded-[32px] bg-gradient-to-br from-blue-600/22 to-cyan-500/12 blur-3xl"
                aria-hidden
              />
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {builtIn.map((c) => (
                  <div
                    key={c.name}
                    title={c.what}
                    style={connectorTint(c.category)}
                    className="mk-card mk-card-hover mk-logo-tile flex aspect-square flex-col items-center justify-center gap-2 p-2 text-center"
                  >
                    <span className="mk-logo-orb flex h-9 w-9 items-center justify-center rounded-xl">
                      <span className="mk-logo-ink flex">
                        <Icon name={c.icon} className="h-5 w-5" />
                      </span>
                    </span>
                    <span className="mk-logo-label text-[11px] font-semibold leading-tight">{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
