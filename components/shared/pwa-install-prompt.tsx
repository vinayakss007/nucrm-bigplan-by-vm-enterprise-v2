'use client';
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      const dismissed = sessionStorage.getItem('pwa-install-dismissed');
      if (!dismissed) {
        setTimeout(() => setShowPrompt(true), 3000);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') setShowPrompt(false);
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    setShowPrompt(false);
    sessionStorage.setItem('pwa-install-dismissed', '1');
  };

  if (!showPrompt || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] animate-slide-up">
      <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 w-[340px]">
        <button onClick={dismiss} className="absolute top-3 right-3 w-6 h-6 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Install NuCRM</p>
            <p className="text-xs text-muted-foreground mt-0.5">Add to your home screen for quick access</p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={dismiss} className="flex-1 py-2 rounded-xl border border-border text-xs font-medium hover:bg-accent transition-colors">
            Not now
          </button>
          <button onClick={install} className="flex-1 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition-colors">
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
