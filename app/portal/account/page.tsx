'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User, Mail, Shield, LogOut, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface PortalSession {
  email: string;
  name: string;
  permissions: { quotes: boolean; invoices: boolean; cases: boolean };
  token: string;
}

function getStoredSession(): PortalSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('portal_session');
    if (!raw) return null;
    const s = JSON.parse(raw) as PortalSession;
    if (!s.email || !s.token) return null;
    return s;
  } catch {
    return null;
  }
}

export default function PortalAccountPage() {
  const router = useRouter();
  const [session, setSession] = useState<PortalSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = getStoredSession();
    if (!s) {
      router.replace('/portal/login');
      return;
    }
    setSession(s);
    setLoading(false);
  }, [router]);

  const logout = () => {
    localStorage.removeItem('portal_session');
    toast.success('Signed out');
    router.replace('/portal/login');
  };

  if (loading || !session) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const permLabels: { key: keyof PortalSession['permissions']; label: string; desc: string }[] = [
    { key: 'quotes', label: 'Quotes', desc: 'View and accept quotes' },
    { key: 'invoices', label: 'Invoices', desc: 'View and download invoices' },
    { key: 'cases', label: 'Support Tickets', desc: 'Create and manage support tickets' },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-lg">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><User className="w-5 h-5" />My Account</h1>
        <p className="text-sm text-muted-foreground">Your portal profile and access details</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-xl font-bold text-violet-600">
            {session.name?.charAt(0)?.toUpperCase() || session.email.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="font-semibold text-lg">{session.name || 'Portal User'}</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />{session.email}
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-5">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4" />Access Permissions
          </h3>
          <div className="space-y-2">
            {permLabels.map(p => (
              <div key={p.key} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.desc}</p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${session.permissions[p.key] ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                  {session.permissions[p.key] ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-5">
          <button onClick={logout}
            className="w-full py-2.5 rounded-xl border border-red-200 dark:border-red-800 text-red-600 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center justify-center gap-2 transition-colors">
            <LogOut className="w-4 h-4" />Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
