/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import { Icon } from '@/components/marketing/icon';
import { MagneticButton, Reveal, StaggerText } from '@/components/marketing/reveal';
import { AppPreview } from '@/components/marketing/mocks';
import { Container, GhostCta, PrimaryCta } from '@/components/marketing/ui';
import { HERO_PROOF } from '@/lib/marketing/home';

/** The hero: headline, the two calls to action, and the live workspace mock. */
export function HomeHero() {
  return (
    <section className="mk-home-hero relative overflow-hidden">
      <div className="mk-home-orbit" aria-hidden="true" />
      <Container className="relative z-10">
        <div className="mk-home-hero-grid">
          <div className="mk-home-copy">
            <Reveal>
              <Link href="/features/ai" className="mk-home-kicker group">
                <span className="mk-home-kicker-dot" />
                The customer operating system
                <Icon name="ArrowUpRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </Reveal>
            <Reveal delay={70}>
              <h1 className="mk-home-title">
                <StaggerText text="Every customer." wordDelay={75} />
                <br />
                <em><StaggerText text="One clear picture." wordDelay={75} startDelay={260} /></em>
              </h1>
            </Reveal>
            <Reveal delay={140}>
              <p className="mk-home-lead">
                Sales, support, billing and marketing come together around one customer record. Your team sees the whole story, knows what to do next, and can get back to work.
              </p>
            </Reveal>
            <Reveal delay={210}>
              <div className="mk-home-actions">
                <MagneticButton><PrimaryCta>Start free — no card</PrimaryCta></MagneticButton>
                <MagneticButton><GhostCta href="/features">Explore the platform</GhostCta></MagneticButton>
              </div>
              <div className="mk-home-proof">
                {HERO_PROOF.map((p) => (
                  <span key={p}><Icon name="Check" /> {p}</span>
                ))}
              </div>
            </Reveal>
            <Reveal delay={280}>
              <div className="mk-home-note">
                <span className="mk-home-note-mark">N</span>
                <span><strong>One workspace.</strong> A lot less busywork.</span>
              </div>
            </Reveal>
          </div>

          <Reveal delay={170} className="mk-home-product-wrap">
            <div className="mk-home-product-label"><span>01 / SALES OVERVIEW</span><span>LIVE WORKSPACE</span></div>
            <div className="mk-home-product">
              <AppPreview />
            </div>
            <div className="mk-home-float-card">
              <span className="mk-home-float-icon"><Icon name="Sparkles" /></span>
              <span><strong>Next step, found.</strong><small>3 follow-ups ready for review</small></span>
              <Icon name="ArrowUpRight" className="mk-home-float-arrow" />
            </div>
            <div className="mk-home-product-caption"><span>One customer record, from first hello to paid invoice.</span><span>Scroll to explore ↓</span></div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
