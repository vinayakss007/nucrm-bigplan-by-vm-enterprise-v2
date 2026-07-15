import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/shared/theme-provider';
import { ErrorWrapper } from '@/components/shared/error-wrapper';
import { Toaster } from 'react-hot-toast';
import OfflineDetector from '@/components/shared/offline-detector';
import PWAInstallPrompt from '@/components/shared/pwa-install-prompt';
import CsrfProvider from '@/components/shared/csrf-provider';
import { ServiceWorkerRegistration } from '@/components/shared/service-worker-registration';
import { SkipLink } from '@/components/ui/skip-link';
import { I18nProvider } from '@/lib/i18n/provider';
import Script from 'next/script';
import { ConfirmPolyfill } from '@/components/shared/confirm-polyfill';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning className="font-sans">
        <script dangerouslySetInnerHTML={{__html:`(function(){function clean(){document.querySelectorAll('[class*=darkreader]').forEach(function(e){e.remove()});document.querySelectorAll('[style]').forEach(function(e){var s=e.getAttribute('style');if(!s)return;var a=s.split(';').filter(function(d){d=d.trim();if(!d)return false;if(/^--darkreader/i.test(d))return false;if(/^background-(image|position|size|repeat|color)\\s*:\\s*(initial|unset)/i.test(d))return false;if(/^(color|border-color|outline-color|text-decoration-color|-webkit-text-fill-color|stroke|fill)\\s*:[^;]*!important/i.test(d))return false;if(/=/.test(d))return false;return true}).join(';');if(a!==e.getAttribute('style'))e.setAttribute('style',a)});document.querySelectorAll('[data-darkreader-inline-stroke],[data-darkreader-inline-color],[data-darkreader-inline-bgcolor],[data-darkreader-inline-fill]').forEach(function(e){e.removeAttribute('data-darkreader-inline-stroke');e.removeAttribute('data-darkreader-inline-color');e.removeAttribute('data-darkreader-inline-bgcolor');e.removeAttribute('data-darkreader-inline-fill')})}clean();new MutationObserver(clean).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','data-darkreader-inline-stroke','data-darkreader-inline-color','data-darkreader-inline-bgcolor','data-darkreader-inline-fill']})})()`}} />
        <I18nProvider>
          <SkipLink />
          <ThemeProvider>
            <ErrorWrapper>
              <CsrfProvider />
              {children}
            </ErrorWrapper>
            <Toaster position="bottom-right" toastOptions={{
              style: { background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', borderRadius: '12px', padding: '10px 14px', fontSize: '13px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', minWidth: '280px' },
              success: { iconTheme: { primary: '#10b981', secondary: 'hsl(var(--card))' } },
              error: { iconTheme: { primary: '#ef4444', secondary: 'hsl(var(--card))' } },
            }} />
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
