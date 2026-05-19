import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: { default: 'Customer Portal | NuCRM', template: '%s | NuCRM' },
  description: 'Customer self-service portal',
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="min-h-screen bg-background">
        <header className="h-14 border-b border-border flex items-center px-6 bg-card sticky top-0 z-40">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white text-xs font-bold">N</div>
            <span className="font-bold text-sm">Customer Portal</span>
          </div>
          <div className="flex-1" />
        </header>
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
