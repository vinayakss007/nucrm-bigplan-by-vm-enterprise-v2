'use client';
import { useState, useEffect } from 'react';
import { useCallback } from 'react';
import { Users, Search, Crown, Plus, ArrowRight, AlertTriangle, Loader2 } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface UserData {
  id: string;
  email: string;
  full_name?: string;
  is_super_admin: boolean;
  created_at: string;
  memberships?: Array<{ tenant_name: string; plan: string }>;
}

interface MeData {
  userId: string;
  ownTenantId?: string;
}

/**
 * Super Admin Users Page
 * 
 * Super admin status can ONLY be set:
 * 1. During initial setup via POST /api/setup/create-admin
 * 2. Via Transfer (current admin gives it to another user)
 * 
 * There is NO Promote/Demote/Revoke buttons.
 * Transfer is the ONLY way to change super admin ownership.
 */
export default function SuperAdminUsersPage() {
  const [users, setUsers]   = useState<UserData[]>([]);
  const [me, setMe]         = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [form, setForm]     = useState({ email:'', full_name:'', password:'' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500";
  const lbl = "block text-xs font-medium text-muted-foreground mb-1";

  const load = useCallback(async () => {
    const q = search ? `?q=${encodeURIComponent(search)}` : '';
    const [res, meRes] = await Promise.all([
      fetch('/api/superadmin/users' + q),
      fetch('/api/superadmin/me'),
    ]);
    const d = await res.json();
    const m = await meRes.json();
    setUsers(d.data||[]);
    setMe(m);
    setLoading(false);
  }, [search]);
  useEffect(() => { load(); }, [load]);

  const transferSuperAdmin = async () => {
    if (!transferTarget) { toast.error('Select a target user'); return; }
      setSaving(true);
    const res = await fetch('/api/superadmin/transfer-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: transferTarget }),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success(d.message || 'Transferred');
      setShowTransfer(false);
      setTransferTarget('');
      setTimeout(() => { window.location.href = '/auth/login'; }, 2000);
    } else {
      toast.error(d.error || 'Failed');
    }
    setSaving(false);
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/superadmin/users',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...form, is_super_admin: false }) });
    const d = await res.json();
    if (res.ok) { toast.success('User created'); setShowCreate(false); setForm({email:'',full_name:'',password:''}); load(); }
    else toast.error(d.error);
    setSaving(false);
  };

  const filtered = users.filter(u => !search || u.email?.includes(search) || u.full_name?.toLowerCase()?.includes(search.toLowerCase()));
  const otherAdmins = users.filter(u => u.is_super_admin && u.id !== me?.userId);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2"><Users className="w-5 h-5 text-violet-400"/>All Users</h1>
          <p className="text-xs text-muted-foreground">{users.length} users across all organizations · {users.filter(u=>u.is_super_admin).length} super admin(s)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setShowTransfer(s=>!s)} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-300/30 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 text-sm font-semibold transition-colors">
            <ArrowRight className="w-4 h-4"/>Transfer Admin
          </button>
          <button onClick={()=>setShowCreate(s=>!s)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4"/>Create User
          </button>
        </div>
      </div>

      {/* Transfer Admin Panel */}
      {showTransfer && (
        <div className="rounded-xl border border-amber-300/30 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-950/10 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500"/>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Transfer Super Admin Status</p>
          </div>
          <p className="text-xs text-muted-foreground">
            This gives the selected user super admin access. You will become a regular user after the transfer.
          </p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className={lbl}>Select target user</label>
              <select value={transferTarget} onChange={e=>setTransferTarget(e.target.value)} className={inp}>
                <option value="">— Choose a user —</option>
                {users.filter(u => u.id !== me?.userId).map(u => (
                  <option key={u.id} value={u.id} className="bg-card">
                    {u.full_name || u.email} {u.is_super_admin ? '(already admin)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={transferSuperAdmin} disabled={saving || !transferTarget}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin"/>}
              Transfer & Step Down
            </button>
          </div>
          {otherAdmins.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              ℹ️ There are {otherAdmins.length} other super admin(s). Transferring will add another admin without removing yours.
            </p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/30"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by email or name..."
          className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-muted/30 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-violet-500"/>
      </div>

      {/* Create form — NO super admin checkbox */}
      {showCreate && (
        <form onSubmit={createUser} className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Create User</p>
            <p className="text-[10px] px-2 py-1 rounded bg-violet-100 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 font-bold">Regular user only</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={lbl}>Email *</label><input type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} required className={inp}/></div>
            <div><label className={lbl}>Full Name</label><input value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))} className={inp}/></div>
            <div><label className={lbl}>Password *</label><input type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} required minLength={12} placeholder="12+ chars, uppercase, number, special" className={inp}/></div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={()=>setShowCreate(false)} className="px-4 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50 transition-colors">
              {saving&&<Loader2 className="w-3.5 h-3.5 animate-spin"/>}Create User
            </button>
          </div>
        </form>
      )}

      {/* Table — READ ONLY, no dangerous action buttons */}
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            {['User','Workspaces','Joined','Status'].map(h=><th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h}</th>)}
          </tr></thead>
          <tbody>
            {loading&&<tr><td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>}
            {!loading&&!filtered.length&&<tr><td colSpan={4} className="text-center py-12 text-muted-foreground text-sm">No users found</td></tr>}
            {filtered.map(u=>(
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {(u.full_name||u.email)?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        {u.full_name||'—'}
                        {u.is_super_admin&&<Crown className="w-3 h-3 text-amber-500"/>}
                        {u.id===me?.userId&&<span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 font-bold">YOU</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
<<<<<<< HEAD
                  {(u.memberships??[]).slice(0,3).map((m,i)=>(
=======
                  {(u.memberships||[]).slice(0,3).map((m,i)=>(
>>>>>>> bc1f7c6 (fix: type safety & error handling polish across 82 pages and components)
                    <div key={i} className="text-xs text-muted-foreground">{m.tenant_name} <span className="text-muted-foreground/50">({m.plan})</span></div>
                  ))}
                  {((u.memberships??[]).length)>3&&<p className="text-[10px] text-muted-foreground/40">+{(u.memberships??[]).length-3} more</p>}
                  {!(u.memberships??[]).length&&<p className="text-xs text-muted-foreground/30">No workspaces</p>}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(u.created_at)}</td>
                <td className="px-4 py-3">
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', u.is_super_admin?'bg-amber-500/15 text-amber-600 dark:text-amber-400':'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}>
                    {u.is_super_admin?'Super Admin':'User'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
