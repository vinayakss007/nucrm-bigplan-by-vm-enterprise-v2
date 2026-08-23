/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import { BRAND } from '@/lib/marketing/site';
import { LegalShell } from '@/components/marketing/legal-shell';

export const metadata: Metadata = {
  title: 'Data processing terms',
  description:
    'How abetworks processes personal data on your behalf in NuCRM: scope, security measures, sub-processors, transfers, data subject requests, breach notification and deletion.',
  alternates: { canonical: '/legal/dpa' },
};

const SECTIONS = [
  { id: 'scope', label: 'Scope and roles' },
  { id: 'processing', label: 'Nature of processing' },
  { id: 'instructions', label: 'Our instructions' },
  { id: 'security', label: 'Security measures' },
  { id: 'staff', label: 'Personnel' },
  { id: 'subprocessors', label: 'Sub-processors' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'requests', label: 'Data subject requests' },
  { id: 'breach', label: 'Breach notification' },
  { id: 'audit', label: 'Audits' },
  { id: 'deletion', label: 'Return and deletion' },
  { id: 'signing', label: 'Getting this signed' },
];

export default function DpaPage() {
  return (
    <LegalShell
      eyebrow="Data processing"
      title="Data processing terms"
      sub="The processor-side commitments your legal team is looking for: scope, security, sub-processors, transfers, breach notification and deletion."
      updated="2026-07-29"
      sections={SECTIONS}
    >
      <p>
        These terms apply where {BRAND.maker} processes personal data on your behalf as part of providing NuCRM. They form
        part of your agreement with us and are summarised here in plain language. A countersignable version is available —
        see <a href="#signing">getting this signed</a>.
      </p>

      <h2 id="scope">Scope and roles</h2>
      <ul>
        <li>
          <strong>You are the controller</strong> of the personal data in your workspace: your contacts, leads, customers,
          ticket requesters and portal users. You decide what to collect and why.
        </li>
        <li>
          <strong>We are the processor.</strong> We handle that data only to provide the service, and only on your
          instructions.
        </li>
        <li>
          For your own account, billing and support data we act as controller — that is covered by our{' '}
          <a href="/legal/privacy">privacy policy</a>, not by these terms.
        </li>
      </ul>

      <h2 id="processing">Nature of the processing</h2>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Subject matter</td>
            <td>Provision of the NuCRM customer relationship platform and its modules</td>
          </tr>
          <tr>
            <td>Duration</td>
            <td>For the term of your subscription, plus the post-cancellation retention window in your agreement</td>
          </tr>
          <tr>
            <td>Purpose</td>
            <td>Storing, organising, retrieving, transmitting and deleting records at your direction</td>
          </tr>
          <tr>
            <td>Categories of data</td>
            <td>
              Contact identifiers, business contact details, communication content, commercial and transaction records, and
              any custom fields you define
            </td>
          </tr>
          <tr>
            <td>Data subjects</td>
            <td>Your customers, prospects, suppliers, candidates, patients or members — whoever you choose to record</td>
          </tr>
          <tr>
            <td>Special categories</td>
            <td>
              Not required by the service. If your use case involves them, you are responsible for the lawful basis and for
              restricting access with field-level permissions and encryption
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="instructions">Processing only on your instructions</h2>
      <ul>
        <li>We process your workspace data only to provide, secure and support the service</li>
        <li>We do not use it for our own purposes, do not sell it, and do not train models on it</li>
        <li>If we believe an instruction breaches data protection law, we will tell you rather than silently comply</li>
        <li>
          Support access to your workspace requires an explicit, time-bound session that is recorded in your audit log and
          visible to your administrators
        </li>
      </ul>

      <h2 id="security">Technical and organisational measures</h2>
      <ul>
        <li>Encryption in transit, encryption at rest, and field-level encryption for sensitive attributes</li>
        <li>Workspace isolation enforced beneath the application rather than by interface filtering</li>
        <li>Role-based access control with record-level and field-level permission rules</li>
        <li>Two-factor authentication, configurable login policies, IP allow-listing and brute-force protection</li>
        <li>Session listing and remote revocation</li>
        <li>Immutable audit logging plus field-level change history</li>
        <li>Data-loss-prevention policies, input sanitisation and tiered rate limiting</li>
        <li>Automated backups with point-in-time and selective restore, and tested restore procedures</li>
        <li>Continuous health, error and security-event monitoring with alerting</li>
      </ul>
      <p>
        The <a href="/security">security overview</a> describes each of these in more detail.
      </p>

      <h2 id="staff">Personnel</h2>
      <ul>
        <li>Access to production data is limited to staff who need it to do their job</li>
        <li>Everyone with access is bound by confidentiality obligations that survive their engagement</li>
        <li>Access is reviewed and revoked promptly when a role changes or ends</li>
      </ul>

      <h2 id="subprocessors">Sub-processors</h2>
      <p>
        We use sub-processors for hosting, message delivery, payment processing, monitoring and — where you enable assistant
        features — AI inference. Each is bound by written terms imposing obligations no weaker than these.
      </p>
      <ul>
        <li>A current list is available on request and provided as part of an Enterprise agreement</li>
        <li>We give notice before adding a sub-processor that processes your workspace data</li>
        <li>You may object on reasonable data protection grounds; if we cannot resolve it, you may terminate the affected service</li>
        <li>We remain responsible to you for our sub-processors&apos; performance</li>
      </ul>

      <h2 id="transfers">International transfers</h2>
      <p>
        Where personal data moves outside its country of origin, we rely on an appropriate transfer mechanism such as
        standard contractual clauses, together with supplementary measures where required. Enterprise agreements can specify
        the region in which your workspace data is stored.
      </p>

      <h2 id="requests">Data subject requests</h2>
      <p>
        Requests from your data subjects should go to you, since you are the controller. The product gives you the tooling to
        handle them yourself:
      </p>
      <ul>
        <li>Subject access request workflow with structured export</li>
        <li>Right-to-erasure handling that resolves dependent records</li>
        <li>Portable data export in a machine-readable format</li>
        <li>Retention policies that expire data automatically on your schedule</li>
      </ul>
      <p>
        If a data subject contacts us directly, we will not respond on your behalf. We will refer them to you and let you
        know. If you need our help to fulfil a request, we will provide reasonable assistance.
      </p>

      <h2 id="breach">Breach notification</h2>
      <ul>
        <li>We notify you without undue delay after becoming aware of a personal data breach affecting your workspace</li>
        <li>
          Our notification covers what we know: the nature of the breach, the categories and approximate volume of data
          involved, likely consequences, and the measures taken or proposed
        </li>
        <li>We provide the information you need to meet your own regulatory notification duties</li>
        <li>We do not require you to keep a breach confidential from your regulator or your affected data subjects</li>
      </ul>

      <h2 id="audit">Audits and information rights</h2>
      <ul>
        <li>We make available the information you reasonably need to demonstrate compliance</li>
        <li>Security documentation and completed questionnaire responses are available on request</li>
        <li>
          Enterprise agreements can provide for an audit, at reasonable frequency and notice, subject to confidentiality and
          without compromising other customers&apos; security
        </li>
      </ul>

      <h2 id="deletion">Return and deletion</h2>
      <ul>
        <li>You can export your data at any time during the subscription, without asking us</li>
        <li>
          After termination, data remains available for export for the window set out in your agreement, then it is deleted
        </li>
        <li>Deletion propagates through backups as the rolling backup cycle turns over</li>
        <li>We retain only what law requires us to keep, such as billing records</li>
        <li>Written confirmation of deletion is available on request</li>
      </ul>

      <h2 id="signing">Getting this signed</h2>
      <p>
        If your procurement process needs a countersigned data processing agreement, standard contractual clauses, a
        sub-processor list or completed security questionnaire, email{' '}
        <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> and we will send the current pack. We do not treat this as a
        hurdle — it is a normal part of selling to serious businesses.
      </p>
    </LegalShell>
  );
}
