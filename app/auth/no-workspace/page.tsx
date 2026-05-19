'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Building2, Loader2, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';

export default function NoWorkspacePage() {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/tenant/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed'); setCreating(false); return; }
    toast.success('Workspace created!');
    router.push('/tenant/dashboard');
    router.refresh();
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/auth/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-violet-500/25"><Zap className="w-7 h-7 text-white" /></div>
          <h1 className="text-2xl font-bold">Set Up Your Workspace</h1>
          <p className="text-muted-foreground mt-2">Create a workspace to get started with NuCRM</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8">
          <form onSubmit={create} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Workspace Name *</label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corp, My Agency..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
            <button type="submit" disabled={creating || !name}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25">
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              <Building2 className="w-4 h-4" />{creating ? 'Creating...' : 'Create Free Workspace'}
            </button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            Have an invite? Check your email for the invitation link.
          </p>
        </div>
        <button onClick={logout} className="w-full mt-4 flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
