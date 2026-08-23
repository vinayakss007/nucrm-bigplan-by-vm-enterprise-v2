/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import PortalHeader from '@/components/portal/portal-header';

export const metadata: Metadata = {
  title: { default: 'Customer Portal | NuCRM', template: '%s | NuCRM' },
  description: 'Customer self-service portal',
};

/**
 * Shared chrome for the customer portal. Authentication itself is enforced
 * server-side in `app/portal/(protected)/layout.tsx` so that /portal/login
 * stays reachable without a session (Issue #1326).
 */
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
