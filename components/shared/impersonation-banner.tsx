/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, ArrowLeft, ShieldAlert } from 'lucide-react';
import { apiFetch } from '@/lib/utils';

export default function ImpersonationBanner() {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const _router = useRouter();

  useEffect(() => {
    // Check if we're impersonating
    const isImp = sessionStorage.getItem('isImpersonating');
    if (isImp === 'true') setVisible(true);
  }, []);

  const stopImpersonation = async () => {
    // The session id is resolved server-side from the admin's own cookie; it is
    // cleared locally here so a stale value cannot outlive the session.
    setError(null);
    const res = await apiFetch('/api/superadmin/impersonate/stop', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error || 'Could not end the impersonation — sign out to drop the tenant session');
      return;
    }
    // apiFetch reloads nothing: the response already swapped the httpOnly session
    // cookie back to the super admin's own token, so a navigation reloads the
    // console with that identity.
    sessionStorage.removeItem('isImpersonating');
    sessionStorage.removeItem('impersonateSessionId');
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
      {error && (
        <div className="w-full text-xs font-medium text-red-900 pt-1">{error}</div>
      )}
    </div>
  );
}
