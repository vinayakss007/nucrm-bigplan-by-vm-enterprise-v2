import type { Metadata } from 'next';
import { COMPLIANCE_ITEMS, RELIABILITY_ITEMS, SECURITY_FAQ, SECURITY_PILLARS } from '@/lib/marketing/security';
import { BRAND } from '@/lib/marketing/site';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { Faq } from '@/components/marketing/faq';
import { GovernanceMock } from '@/components/marketing/mocks';
import {
  Container,
  CtaBand,
  GhostCta,
  IconTile,
  PageHero,
  Section,
  SectionHeading,
} from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'Security, compliance & reliability',
  description:
    'How NuCRM protects your data: workspace isolation at the data layer, field-level permissions, SSO, encryption, immutable audit trails, GDPR request handling and tested backups.',
  alternates: { canonical: '/security' },
};

export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Trust"
        title={
          <>
            Written for the person who has to <span className="mk-grad-violet">sign it off</span>
          </>
        }
        sub="Not a badge wall. Below is what is actually implemented, described plainly enough that a reviewer can check it — including the places where something is a commitment rather than a shipped control."
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Security', href: '/security' },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <GhostCta href="/contact">Request our security pack</GhostCta>
          <GhostCta href="#faq">Read the direct answers</GhostCta>
        </div>
      </PageHero>

      {/* pillars */}
      <Section className="!pt-6">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2">
            {SECURITY_PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={(i % 2) * 70} className="mk-card flex h-full flex-col p-6">
                <div className="flex items-start gap-4">
                  <IconTile name={p.icon} accent={p.accent} />
                  <div className="min-w-0 flex-1">
                    <h2 className="mk-h3 text-white">{p.title}</h2>
                    <p className="mk-body mt-2">{p.body}</p>
                  </div>
                </div>
                <ul className="mt-5 space-y-2 border-t border-white/[0.07] pt-5">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex gap-2.5">
                      <Icon name="Check" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-emerald-400" strokeWidth={2.4} />
                      <span className="text-[13px] leading-relaxed text-slate-400">{pt}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* the screen */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="See it, do not take our word"
            title="Permissions and audit are screens, not promises"
            sub="Roles, scopes, field-level rules and the immutable audit trail are administrator screens inside every workspace. Your reviewers can look at them during the trial."
          />
          <Reveal delay={100} className="relative mt-12">
            <div
              className="pointer-events-none absolute -inset-6 -z-10 rounded-[36px] bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 blur-3xl"
              aria-hidden
            />
            <GovernanceMock />
          </Reveal>
        </Container>
      </Section>

      {/* compliance */}
      <Section id="compliance">
        <Container>
          <SectionHeading
            eyebrow="Compliance"
            title="The obligations, handled in product"
            sub="Data subject requests, retention and audit evidence are features you operate yourself — not support tickets you raise with us and wait on."
          />
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {COMPLIANCE_ITEMS.map((c, i) => (
              <Reveal key={c.title} delay={i * 70} className="mk-card flex h-full flex-col p-6">
                <IconTile name={c.icon} accent="from-emerald-400 to-teal-500" />
                <h3 className="mk-h3 mt-4 text-white">{c.title}</h3>
                <p className="mk-body mt-2.5 flex-1">{c.body}</p>
                <ul className="mt-5 space-y-2 border-t border-white/[0.07] pt-5">
                  {c.points.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                      <span className="text-[13px] leading-relaxed text-slate-400">{p}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>

          <Reveal delay={100} className="mk-card mt-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
            <Icon name="ClipboardCheck" className="h-6 w-6 shrink-0 text-amber-300" />
            <p className="mk-small flex-1 !text-slate-300">
              <strong>On certification, plainly:</strong> the controls the SOC 2 trust criteria expect are implemented in
              the product. Where you need an external attestation report, ask us for the current status rather than
              inferring it from a logo — we would rather answer the question than imply an answer.
            </p>
            <GhostCta href="/contact">Ask us</GhostCta>
          </Reveal>
        </Container>
      </Section>

      {/* reliability */}
      <Section id="reliability" tone="soft">
        <Container>
          <SectionHeading
            eyebrow="Reliability"
            title="Recoverable by design"
            sub="Most data loss is not a breach. It is a bulk action, a bad import or a departing employee — so the product is built to be undone."
          />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RELIABILITY_ITEMS.map((r, i) => (
              <Reveal key={r.title} delay={(i % 3) * 60} className="mk-card mk-card-hover p-6">
                <IconTile name={r.icon} accent="from-cyan-400 to-blue-500" size="sm" />
                <h3 className="mk-h4 mt-4 text-white">{r.title}</h3>
                <p className="mk-body mt-2">{r.body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* faq */}
      <Section id="faq">
        <Container>
          <SectionHeading
            eyebrow="Direct answers"
            title="The questions security reviews always ask"
            sub="Short answers, no hedging. If you need any of these in writing on letterhead, ask and we will send it."
          />
          <div className="mt-12">
            <Faq items={SECURITY_FAQ} />
          </div>

          <Reveal delay={80} className="mk-card mt-8 flex flex-col gap-4 p-6 text-center sm:flex-row sm:items-center sm:text-left">
            <Icon name="ShieldCheck" className="mx-auto h-6 w-6 shrink-0 text-emerald-400 sm:mx-0" />
            <p className="mk-small flex-1 !text-slate-300">
              Found something that looks wrong? Report it to{' '}
              <a href={`mailto:${BRAND.email}`} className="mk-link">
                {BRAND.email}
              </a>
              . We acknowledge reports quickly, keep you updated through triage and remediation, and credit reporters who
              want to be credited.
            </p>
          </Reveal>
        </Container>
      </Section>

      <CtaBand
        title="Put it in front of your security reviewer"
        sub="Start a free workspace, open the roles and audit screens, and let them judge it directly. We will answer anything the trial cannot."
        primary={{ label: 'Start free', href: '/auth/signup' }}
        secondary={{ label: 'Request the security pack', href: '/contact' }}
      />
    </>
  );
}
