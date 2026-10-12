/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import localFont from 'next/font/local';
import { ThemeProvider } from '@/components/shared/theme-provider';
import { ErrorWrapper } from '@/components/shared/error-wrapper';
import { Toaster } from 'react-hot-toast';
import OfflineDetector from '@/components/shared/offline-detector';
import PWAInstallPrompt from '@/components/shared/pwa-install-prompt';
import CsrfProvider from '@/components/shared/csrf-provider';
import AnalyticsProvider from '@/components/shared/analytics-provider';
import { ServiceWorkerRegistration } from '@/components/shared/service-worker-registration';
import { SkipLink } from '@/components/ui/skip-link';
import { I18nProvider } from '@/lib/i18n/provider';
import { ConfirmPolyfill } from '@/components/shared/confirm-polyfill';
import { SWRProvider } from '@/lib/swr-config';
import { QueryProvider } from '@/lib/query/client';
import Script from 'next/script';
import './globals.css';

/**
 * Force dynamic rendering for every page (#1968).
 *
 * proxy.ts sends a per-request CSP nonce (#1070) that Next stamps into
 * scripts/styles ONLY when a page renders dynamically. Any statically
 * prerendered page would serve build-time HTML whose inline scripts predate
 * the request nonce, so the browser blocks them and production shows a
 * white screen. Forcing dynamic rendering here guarantees the response CSP
 * nonce always matches the rendered markup. Cost: marketing pages lose
 * static prerendering (acceptable for an authenticated SaaS app; revisit
 * with per-route static policies if marketing TTFB ever matters).
 */
export const dynamic = 'force-dynamic';

// #2426 — self-hosted, byte-for-byte the same files `next/font/google` used to
// download at build time (latin subset, static weight instances, from
// fonts.gstatic.com). A build that fetches fonts is not hermetic: CI's Build
// job failed on an unchanged commit because the font query could not resolve,
// and the production image build had the same hidden dependency on Google
// being reachable. Keeping the two `variable` names identical means no other
// file changes, and `adjustFontFallback` stays on so the metric-matched
// fallback @font-face (size-adjust) is still generated from these files.
const inter = localFont({
  src: [
    { path: './fonts/inter-latin-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter-latin-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/inter-latin-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/inter-latin-700.woff2', weight: '700', style: 'normal' },
    { path: './fonts/inter-latin-800.woff2', weight: '800', style: 'normal' },
    { path: './fonts/inter-latin-900.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = localFont({
  src: [
    { path: './fonts/jetbrains-mono-latin-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/jetbrains-mono-latin-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'NuCRM', template: '%s | NuCRM' },
  description: 'The modern CRM platform for growing teams',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'NuCRM', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#7c3aed',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // #2331: next-themes writes its blocking bootstrap <script> itself, so Next
  // does not auto-stamp the per-request CSP nonce (#1070) onto it — without
  // the nonce the browser blocks it and theme init silently fails. proxy.ts
  // exposes the nonce on the x-nonce request header; pass it through.
  const cspNonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // suppressHydrationWarning is scoped to <html> ONLY and is unavoidable:
    // next-themes writes the `class`/`style` (theme) attributes onto the <html>
    // element before React hydrates, so without it React would report a
    // benign mismatch on those two attributes. Crucially, suppressHydrationWarning
    // does NOT cascade to descendants — hydration errors inside the app tree
    // (and on <body>) are still surfaced normally (#1306).
    //
    // Do NOT add suppressHydrationWarning to <body>. Browser extensions
    // (Dark Reader, Grammarly, …) mutate <body> before hydration; instead of
    // hiding those with a blanket suppression, dark-reader-cleanup runs with
    // Next.js `beforeInteractive` strategy so the injected attributes are
    // stripped BEFORE React reconciles, keeping <body> server/client identical.
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* #2331: goober (react-hot-toast's CSS engine) stamps its injected
            <style> elements from window.__nonce__ — without this the 8 toast
            keyframe blocks violate style-src-elem and toasts render
            unanimated. Values are JSON-serialized, never interpolated raw. */}
        {cspNonce && (
          <script
            nonce={cspNonce}
            dangerouslySetInnerHTML={{ __html: `window.__nonce__=${JSON.stringify(cspNonce)};` }}
          />
        )}
        <Script src="/dark-reader-cleanup.js" strategy="beforeInteractive" />
      </head>
      <body className="font-sans">
        <I18nProvider>
          <SkipLink />
          <ThemeProvider nonce={cspNonce}>
            <ErrorWrapper>
              <CsrfProvider />
              <AnalyticsProvider />
              <QueryProvider><SWRProvider>{children}</SWRProvider></QueryProvider>
            </ErrorWrapper>
            <div aria-live="polite" aria-atomic="true" role="status">
              <Toaster position="bottom-right" toastOptions={{
                style: { background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', borderRadius: '12px', padding: '10px 14px', fontSize: '13px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', minWidth: '280px' },
                success: { iconTheme: { primary: '#10b981', secondary: 'hsl(var(--card))' } },
                error: { iconTheme: { primary: '#ef4444', secondary: 'hsl(var(--card))' } },
              }} />
            </div>
            <OfflineDetector />
            <PWAInstallPrompt />
            <ConfirmPolyfill />
            <ServiceWorkerRegistration />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
