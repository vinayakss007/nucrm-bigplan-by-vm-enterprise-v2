import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND } from '@/lib/marketing/site';
import { Icon } from '@/components/marketing/icon';
import { Reveal } from '@/components/marketing/reveal';
import { ContactForm } from '@/components/marketing/contact-form';
import { Container, CtaBand, IconTile, PageHero, Section, SectionHeading } from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'Contact abetworks',
  description:
    'Talk to the team behind NuCRM about pricing, migration, enterprise procurement or a security review. A real person replies.',
  alternates: { canonical: '/contact' },
};

/**
 * Enquiries are routed into abetworks' own NuCRM workspace through the public
 * lead-capture endpoint. That needs a destination workspace id, configured as
 * NEXT_PUBLIC_MARKETING_TENANT_ID. When it is absent we show direct email
 * contact instead of a form that would fail on submit.
 */
const MARKETING_TENANT_ID = process.env.NEXT_PUBLIC_MARKETING_TENANT_ID ?? '';

const ROUTES = [
  {
    t: 'Sales & pricing',
    d: 'Plan fit, volume pricing, annual terms and anything a quote needs to say.',
    email: BRAND.sales,
    i: 'Wallet',
    accent: 'from-violet-500 to-indigo-500',
  },
  {
    t: 'Existing customer support',
    d: 'Answered by people who work on the product. Faster from inside your workspace.',
    email: BRAND.support,
    i: 'LifeBuoy',
    accent: 'from-rose-400 to-pink-500',
  },
  {
    t: 'Security & procurement',
    d: 'Security pack, data processing agreement, sub-processor list, questionnaire responses.',
    email: BRAND.email,
    i: 'ShieldCheck',
    accent: 'from-emerald-400 to-teal-500',
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={
          <>
            Tell us what you are trying to fix — <span className="mk-grad-violet">we will be straight with you</span>
          </>
        }
        sub="Including if NuCRM is the wrong tool for it. We would rather lose the sale than have you churn in six months."
        breadcrumb={[
          { label: 'Home', href: '/' },
          { label: 'Contact', href: '/contact' },
        ]}
      />

      <Section className="!pt-4">
        <Container>
          <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
            {/* form or fallback */}
            <Reveal>
              {MARKETING_TENANT_ID ? (
                <ContactForm tenantId={MARKETING_TENANT_ID} />
              ) : (
                <div className="mk-card p-7">
                  <IconTile name="Mail" size="lg" />
                  <h2 className="mk-h3 mt-5 text-white">Email us directly</h2>
                  <p className="mk-body mt-3">
                    The quickest route is straight to the inbox. Tell us what you are trying to do, roughly how many people
                    would use it, and what you are moving from — that is usually enough for a genuinely useful first reply.
                  </p>
                  <a href={`mailto:${BRAND.email}`} className="mk-btn mk-btn-primary mt-6">
                    {BRAND.email}
                    <Icon name="ArrowRight" className="h-4 w-4" strokeWidth={2.2} />
                  </a>
                  <p className="mk-tiny mt-4">Replies normally within one working day.</p>
                </div>
              )}
            </Reveal>

            {/* routes */}
            <div className="space-y-4">
              {ROUTES.map((r, i) => (
                <Reveal key={r.t} delay={i * 70} className="mk-card p-6">
                  <div className="flex items-start gap-3.5">
                    <IconTile name={r.i} accent={r.accent} size="sm" />
                    <div className="min-w-0">
                      <h3 className="mk-h4 text-white">{r.t}</h3>
                      <p className="mk-small mt-1">{r.d}</p>
                      <a href={`mailto:${r.email}`} className="mk-link mt-2.5 inline-block text-[13px]">
                        {r.email}
                      </a>
                    </div>
                  </div>
                </Reveal>
              ))}

              <Reveal delay={220} className="mk-card p-6">
                <h3 className="mk-h4 text-white">Faster than emailing us</h3>
                <div className="mt-4 space-y-2">
                  {[
                    { t: 'Start a free workspace', d: 'Most questions answer themselves in ten minutes.', h: '/auth/signup' },
                    { t: 'Read the feature catalogue', d: 'Every capability, named, no asterisks.', h: '/features' },
                    { t: 'Check the pricing matrix', d: 'Exactly what each plan includes.', h: '/pricing' },
                    { t: 'Read the security overview', d: 'Isolation, permissions, audit, GDPR, backups.', h: '/security' },
                  ].map((l) => (
                    <Link
                      key={l.h}
                      href={l.h}
                      className="group flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.04]"
                    >
                      <Icon
                        name="ArrowRight"
                        className="mt-0.5 h-4 w-4 shrink-0 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:text-violet-300"
                        strokeWidth={2.2}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold text-slate-200 group-hover:text-white">
                          {l.t}
                        </span>
                        <span className="mk-tiny mt-0.5 block">{l.d}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </Section>

      {/* what happens next */}
      <Section tone="soft">
        <Container>
          <SectionHeading
            eyebrow="What happens next"
            title="No sequence, no seventeen-step nurture"
            sub="You contacted us with a question. We answer the question."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              { t: 'A person reads it', d: 'Someone who works on the product, not a routing desk.', i: 'Users' },
              { t: 'You get a useful reply', d: 'Usually within one working day, answering what you actually asked.', i: 'MessageSquare' },
              { t: 'You decide', d: 'A call if you want one. If you would rather just try it, that is fine too.', i: 'Check' },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 70} className="mk-card p-6">
                <span className="mk-mono flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10 text-violet-300">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mk-h4 mt-4 text-white">{c.t}</h3>
                <p className="mk-body mt-2">{c.d}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <CtaBand
        title="Or skip the conversation entirely"
        sub="The free plan needs no card and no call. Sign up, import a slice of your data, and judge it yourself."
        primary={{ label: 'Start free', href: '/auth/signup' }}
        secondary={{ label: 'About abetworks', href: '/abetworks' }}
      />
    </>
  );
}
