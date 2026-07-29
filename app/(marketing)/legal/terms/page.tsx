import type { Metadata } from 'next';
import { BRAND } from '@/lib/marketing/site';
import { LegalShell } from '@/components/marketing/legal-shell';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The terms on which abetworks provides NuCRM: your account, your data, our commitments, payment and cancellation.',
  alternates: { canonical: '/legal/terms' },
};

const SECTIONS = [
  { id: 'agreement', label: 'The agreement' },
  { id: 'account', label: 'Your account' },
  { id: 'data', label: 'Your data' },
  { id: 'acceptable', label: 'Acceptable use' },
  { id: 'plans', label: 'Plans and modules' },
  { id: 'payment', label: 'Payment' },
  { id: 'availability', label: 'Availability' },
  { id: 'support', label: 'Support' },
  { id: 'ip', label: 'Intellectual property' },
  { id: 'ai', label: 'AI features' },
  { id: 'termination', label: 'Cancellation' },
  { id: 'liability', label: 'Warranties and liability' },
  { id: 'changes', label: 'Changes' },
  { id: 'contact', label: 'Contact' },
];

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Terms of service"
      title="Terms of service"
      sub="The deal between us, in language you can actually check. Where a clause protects us, we say so rather than hiding it in a definition."
      updated="2026-07-29"
      sections={SECTIONS}
    >
      <p>
        These terms govern your use of NuCRM, provided by {BRAND.maker}. By creating an account or using the service you
        agree to them. If you are agreeing on behalf of a company, you confirm you are authorised to bind it.
      </p>

      <h2 id="agreement">The agreement</h2>
      <p>
        Your agreement with us consists of these terms, our <a href="/legal/privacy">privacy policy</a>, our{' '}
        <a href="/legal/dpa">data processing terms</a>, and — if you are on an Enterprise plan — the signed order form.
        Where a signed order form conflicts with these terms, the order form wins.
      </p>

      <h2 id="account">Your account</h2>
      <ul>
        <li>You are responsible for what happens under your account, including actions by users you invite</li>
        <li>Keep credentials confidential and enable two-factor authentication; tell us promptly about any compromise</li>
        <li>You must provide accurate account and billing information and keep it current</li>
        <li>One person may not share a named user seat with another; add a seat instead</li>
        <li>You must be legally capable of entering a contract and not barred from using the service under applicable law</li>
      </ul>

      <h2 id="data">Your data stays yours</h2>
      <ul>
        <li>You own everything you put into your workspace. Using the service transfers no ownership to us</li>
        <li>We access your workspace content only to provide and support the service, and only as you instruct</li>
        <li>Support access requires an explicit, time-bound session recorded in your audit log</li>
        <li>You can export your data at any time, by entity or as a full workspace export, without asking us</li>
        <li>We do not sell your data, and we do not use your workspace content to train models</li>
        <li>You are responsible for having a lawful basis for the personal data you upload</li>
      </ul>

      <h2 id="acceptable">Acceptable use</h2>
      <p>Do not use NuCRM to:</p>
      <ul>
        <li>Send unsolicited bulk messages, or contact people who have not consented where consent is required</li>
        <li>Store or distribute unlawful content, malware, or material that infringes someone else&apos;s rights</li>
        <li>Attempt to access another workspace, probe or disrupt the service, or circumvent limits and safeguards</li>
        <li>Resell or white-label the service outside the terms of an Enterprise agreement that permits it</li>
        <li>Use the service to build a competing product by systematic extraction of its behaviour</li>
      </ul>
      <p>
        Security research is welcome. Test only against your own workspace, do not access anyone else&apos;s data, and report
        findings to <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>. We will not pursue good-faith research that follows
        those rules.
      </p>
      <p>
        We may suspend an account that presents an active risk to the service or to other customers. Except in urgent cases
        we will contact you first, and we will always tell you why.
      </p>

      <h2 id="plans">Plans and modules</h2>
      <ul>
        <li>Capabilities available to you depend on your plan and the modules enabled on your workspace</li>
        <li>Adding or removing a module takes effect from the next billing period unless we agree otherwise</li>
        <li>Plan limits on records, storage, API calls and AI credits are visible in your workspace</li>
        <li>
          If you exceed a limit we will tell you and give you the chance to upgrade. We do not silently invoice overage
        </li>
        <li>Enterprise plans include all modules for the term of the agreement</li>
      </ul>

      <h2 id="payment">Payment</h2>
      <ul>
        <li>Paid plans are billed per user, monthly or annually in advance, plus any module add-ons</li>
        <li>Fees are exclusive of tax; we add tax where we are required to collect it</li>
        <li>Adding users mid-cycle is pro-rated; removing users takes effect at the next renewal</li>
        <li>Subscriptions renew automatically until cancelled. Annual renewals are notified in advance</li>
        <li>Unpaid invoices may lead to suspension after written notice. Your data is not deleted during suspension</li>
        <li>We may change list prices with at least 30 days&apos; notice, effective from your next renewal</li>
        <li>
          Fees already paid are non-refundable except where required by law, or where we materially fail to provide the
          service
        </li>
      </ul>

      <h2 id="availability">Availability</h2>
      <p>
        We work to keep NuCRM available continuously, and we monitor it accordingly. On plans below Enterprise the service
        is provided without a contractual uptime commitment. Enterprise agreements include a service-level agreement with
        defined targets and remedies.
      </p>
      <p>
        Planned maintenance is announced in advance where it could be disruptive. We are not liable for downtime caused by
        factors outside our control, including your network, your own integrations or a third-party provider outage.
      </p>

      <h2 id="support">Support</h2>
      <ul>
        <li>Free: community resources and documentation</li>
        <li>Starter: email support</li>
        <li>Pro: priority email support</li>
        <li>Enterprise: named contact, onboarding assistance and contractual response targets</li>
      </ul>

      <h2 id="ip">Intellectual property</h2>
      <p>
        NuCRM, its software, design and documentation remain the property of {BRAND.maker}. You get a non-exclusive,
        non-transferable right to use the service during your subscription. You may not copy, decompile or create
        derivative works from the software except as the law expressly permits.
      </p>
      <p>
        If you send us feedback or feature suggestions, we may act on them without obligation or payment. That does not give
        us any right to your data.
      </p>

      <h2 id="ai">AI features</h2>
      <ul>
        <li>Assistant output is generated and can be wrong. Review before you send anything to a customer</li>
        <li>Nothing is sent on your behalf unless you explicitly enable an automation that does so</li>
        <li>You are responsible for the content you approve and send</li>
        <li>AI usage consumes credits, metered and visible per workspace; you may supply your own provider key instead</li>
      </ul>

      <h2 id="termination">Cancellation and termination</h2>
      <ul>
        <li>You can cancel at any time from your workspace billing settings. Cancellation takes effect at period end</li>
        <li>Export your data before the retention window in your agreement expires; after that it is deleted</li>
        <li>We may terminate for material breach that you do not remedy after written notice</li>
        <li>If we discontinue the service, we will give reasonable notice and a full export path</li>
      </ul>

      <h2 id="liability">Warranties and liability</h2>
      <p>
        We provide the service with reasonable skill and care. Beyond that, and to the extent the law allows, the service is
        provided without further warranties — including any implied warranty of fitness for a particular purpose.
      </p>
      <p>
        To the extent permitted by law, neither party is liable for indirect or consequential loss, lost profits or lost
        revenue. Our total liability in any twelve-month period is limited to the fees you paid us in that period. Nothing
        in these terms limits liability that cannot lawfully be limited.
      </p>

      <h2 id="changes">Changes to these terms</h2>
      <p>
        We may update these terms. For material changes we will notify account owners by email at least 30 days before they
        take effect. Continuing to use the service after that date means you accept the revised terms. If you do not, you
        may cancel and we will refund any prepaid period not yet used.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>.
      </p>
    </LegalShell>
  );
}
