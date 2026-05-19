'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, CheckCircle, AlertTriangle, Loader2, Mail } from 'lucide-react';
import toast from 'react-hot-toast';

function AcceptInviteContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const router = useRouter();
  const [invitation, setInvitation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (!token) { setError('Invalid invitation link'); setLoading(false); return; }
    // Fetch invite details
    fetch(`/api/auth/invite-details?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); } else { setInvitation(d); setIsLoggedIn(d.isLoggedIn); }
        setLoading(false);
      })
      .catch(() => { setError('Failed to load invitation'); setLoading(false); });
  }, [token, router]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccepting(true);

    // If not logged in, create account first
    if (!isLoggedIn) {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invitation.email, password, full_name: name, workspace_name: '__invite__' }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error); setAccepting(false); return; }
    }

    // Accept invitation
    const res = await fetch('/api/auth/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed'); setAccepting(false); return; }
    toast.success(`Welcome to ${invitation?.tenant_name}!`);
    router.push('/tenant/dashboard');
    router.refresh();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>;
  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mx-auto"><AlertTriangle className="w-7 h-7 text-red-500" /></div>
        <h2 className="text-xl font-bold">Invitation Invalid</h2>
        <p className="text-muted-foreground">{error}</p>
        <a href="/auth/login" className="inline-flex items-center px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700">Go to Login</a>
      </div>
    </div>
  );

  const accent = invitation?.primary_color || '#7c3aed';
  const inp = "w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-muted-foreground";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 text-white text-xl font-bold shadow-lg" style={{ background: accent }}>
            {invitation?.tenant_name?.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold">{invitation?.tenant_name}</h1>
          <p className="text-muted-foreground mt-1">You've been invited to join</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8">
          <div className="flex items-center gap-3 p-3 rounded-xl mb-5" style={{ background: accent + '15', border: `1px solid ${accent}30` }}>
            <Mail className="w-5 h-5 shrink-0" style={{ color: accent }} />
            <div>
              <p className="text-sm font-medium">{invitation?.email}</p>
              <p className="text-xs text-muted-foreground">Invited as <strong className="capitalize">{invitation?.role_slug?.replace('_',' ')}</strong></p>
            </div>
          </div>
          <form onSubmit={accept} className="space-y-4">
            {!isLoggedIn && (
              <>
                <div><label className="block text-sm font-medium mb-1.5">Your Full Name</label><input required value={name} onChange={e=>setName(e.target.value)} placeholder="Jane Smith" className={inp}/></div>
                <div><label className="block text-sm font-medium mb-1.5">Create Password</label><input type="password" required value={password} onChange={e=>setPassword(e.target.value)} minLength={12} placeholder="12+ chars, uppercase, number, special" className={inp}/></div>
              </>
            )}
            {isLoggedIn && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                <p className="text-sm text-emerald-700 dark:text-emerald-400">You're already signed in. Click below to join the workspace.</p>
              </div>
            )}
            <button type="submit" disabled={accepting}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: accent }}>
              {accepting && <Loader2 className="w-4 h-4 animate-spin" />}
              {accepting ? 'Joining...' : `Join ${invitation?.tenant_name} →`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>
    }>
      <AcceptInviteContent />
    </Suspense>
  );
}
