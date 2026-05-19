'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, User, ArrowLeft, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ImpersonationBanner() {
  const [visible, setVisible] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Check if we're impersonating
    const isImp = sessionStorage.getItem('isImpersonating');
    if (isImp === 'true') setVisible(true);
  }, []);

  const stopImpersonation = async () => {
    const sessionId = sessionStorage.getItem('impersonateSessionId');
    if (sessionId) {
      await fetch('/api/superadmin/impersonate/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    }
    sessionStorage.removeItem('isImpersonating');
    sessionStorage.removeItem('impersonateSessionId');
    // Clear session cookie
    document.cookie = 'session=; Path=/; Max-Age=0';
    // Go back to superadmin
    window.location.href = '/superadmin/tenants';
  };

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 px-4 py-2.5 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4" />
        <span className="text-sm font-semibold">Impersonation Mode</span>
        <span className="text-xs opacity-75">— You are viewing this tenant&apos;s CRM as a user</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { window.location.href = '/superadmin/tenants'; }}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-600/30 hover:bg-amber-600/50 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" /> Back to Super Admin
        </button>
        <button
          onClick={stopImpersonation}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-600/30 hover:bg-amber-600/50 transition-colors"
        >
          <X className="w-3 h-3" /> Stop Impersonation
        </button>
      </div>
    </div>
  );
}
