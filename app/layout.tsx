import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/shared/theme-provider';
import { ErrorWrapper } from '@/components/shared/error-wrapper';
import { Toaster } from 'react-hot-toast';
import OfflineDetector from '@/components/shared/offline-detector';
import PWAInstallPrompt from '@/components/shared/pwa-install-prompt';
import { ServiceWorkerRegistration } from '@/components/shared/service-worker-registration';
import { SkipLink } from '@/components/ui/skip-link';
import { I18nProvider } from '@/lib/i18n/provider';
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
        <I18nProvider>
          <SkipLink />
          <ThemeProvider>
            <ErrorWrapper>{children}</ErrorWrapper>
            <Toaster position="bottom-right" toastOptions={{
              style: { background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', borderRadius: '10px', fontSize: '13px' },
            }} />
            <OfflineDetector />
            <PWAInstallPrompt />
            <ServiceWorkerRegistration />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
