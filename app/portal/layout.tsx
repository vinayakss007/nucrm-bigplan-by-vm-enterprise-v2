import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import PortalHeader from '@/components/portal/portal-header';

export const metadata: Metadata = {
  title: { default: 'Customer Portal | NuCRM', template: '%s | NuCRM' },
  description: 'Customer self-service portal',
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="min-h-screen bg-background">
        <PortalHeader />
        <main className="max-w-5xl mx-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
      <Toaster position="bottom-right" toastOptions={{
        style: { background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', borderRadius: '10px', fontSize: '13px' },
      }} />
    </>
  );
}
