/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import { BRAND } from '@/lib/marketing/site';
import { LegalShell } from '@/components/marketing/legal-shell';

export const metadata: Metadata = {
  title: 'Cookie policy',
  description:
    'Which cookies and local-storage entries NuCRM sets and why: session cookies, login-flow state, interface preferences, and how to control them.',
  alternates: { canonical: '/legal/cookies' },
};

const SECTIONS = [
  { id: 'what', label: 'What we store' },
  { id: 'essential', label: 'Essential cookies' },
  { id: 'login', label: 'Login-flow state' },
  { id: 'storage', label: 'Local storage' },
  { id: 'third-party', label: 'Third parties' },
  { id: 'control', label: 'Controlling storage' },
  { id: 'changes', label: 'Changes to this policy' },
];

export default function CookiesPage() {
  return (
    <LegalShell
      eyebrow="Cookie policy"
      title="Cookie policy"
      sub="NuCRM is a working business application, not an advertising surface. This policy says exactly what your browser stores on our behalf and what it is used for."
      updated="2026-10-05"
      sections={SECTIONS}
    >
      <p>
        This policy covers the {BRAND.product} website and application operated by {BRAND.maker}. It explains which cookies
        and browser-storage entries we set, what each one does, and how you can control them. It is part of our{' '}
        <a href="/legal/privacy">privacy policy</a> — read that for how personal data is handled overall.
      </p>

      <h2 id="what">What we store in your browser</h2>
      <p>
        We use a deliberately small amount of browser storage. Everything we set exists either to keep you signed in, to
        complete a sign-in, or to remember how you like the interface to look. We do not set advertising, profiling or
        cross-site tracking cookies.
      </p>

      <h2 id="essential">Essential cookies</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Purpose</th>
            <th>Lifetime</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>nucrm_session</code>
            </td>
            <td>Keeps you signed in to your workspace and binds requests to your session. Without it the application cannot
              work at all.</td>
            <td>Until you sign out or the session expires</td>
          </tr>
        </tbody>
      </table>
      <p>
        Session cookies are strictly necessary for the service. They are flagged <code>HttpOnly</code> and{' '}
        <code>Secure</code>, and they are not used for analytics.
      </p>

      <h2 id="login">Login-flow state</h2>
      <p>While you are signing in — especially through single sign-on — a few short-lived cookies carry state between steps:</p>
      <ul>
        <li>
          <code>oauth_state</code> and <code>sso_state</code> — a one-use value that proves the response coming back to you
          belongs to the sign-in you started. This is a standard defence against request forgery in the OAuth and SAML flows.
        </li>
        <li>
          <code>sso_tenant_id</code> — remembers which workspace you chose so the single sign-on redirect lands in the right
          place.
        </li>
      </ul>
      <p>These exist only for the duration of a sign-in attempt and carry no personal data beyond that choice of workspace.</p>

      <h2 id="storage">Browser local storage</h2>
      <p>
        Interface preferences are kept in your browser&apos;s local storage rather than in cookies, so the application loads
        with your settings before any request is made:
      </p>
      <ul>
        <li>Theme (light or dark) and sidebar state</li>
        <li>Language / locale preference</li>
        <li>Which workspaces you last used, and whether onboarding has been dismissed</li>
        <li>A saved identifier used only to prefill your email on the sign-in screen when you opt into &quot;remember me&quot;</li>
      </ul>
      <p>None of this is transmitted to us on page loads, and clearing your browser storage removes all of it.</p>

      <h2 id="third-party">Third parties</h2>
      <ul>
        <li>We do not embed advertising pixels, social-media trackers or marketing-analytics scripts on NuCRM pages.</li>
        <li>
          Payment pages are handled by our payment processor; that provider may set its own cookies while you are completing
          a purchase, governed by its own policy.
        </li>
        <li>Error monitoring collects technical diagnostics (device and browser information) but does not rely on cookies.</li>
      </ul>

      <h2 id="control">Controlling cookies and storage</h2>
      <p>
        Your browser lets you block or delete cookies and clear site storage at any time. Because the cookies above are
        essential, blocking them will prevent signing in and may break the interface&apos;s memory of your preferences — the
        informational pages will still load. On the application itself, signing out clears the session cookie, and{' '}
        <em>Clear site data</em> in your browser removes everything we have stored locally.
      </p>
      <p>
        The cookie-consent banner on this site records your choice between essential-only storage and the optional local
        preferences above; you can change it at any time by clearing the <code>nucrm_cookie_consent</code> entry in your
        browser&apos;s storage.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        If we add functionality that needs new browser storage, we will update this page and its date. Questions about
        cookies or any other storage can go to <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>.
      </p>
    </LegalShell>
  );
}
