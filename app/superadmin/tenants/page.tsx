'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Building2, Plus, Search, X, LogIn, Trash2, Loader2, Crown, Mail,
  DollarSign, Shield, RefreshCw, Edit, Save, Zap } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';

const STATUS_COLORS: Record<string,string> = {
  active:       'bg-emerald-500/15 text-emerald-400',
  trialing:     'bg-amber-500/15 text-amber-400',
  suspended:    'bg-red-500/15 text-red-400',
  trial_expired:'bg-red-500/15 text-red-400',
  cancelled:    'bg-slate-500/15 text-slate-400',
  past_due:     'bg-orange-500/15 text-orange-400',
};
const BILLING_TYPE_COLORS: Record<string,string> = {
  trial:         'text-amber-400',
  stripe:        'text-emerald-400',
  manual:        'text-blue-400',
  lifetime:      'text-purple-400',
  complimentary: 'text-pink-400',
};
const PLANS = ['free','starter','pro','enterprise'];
const STATUSES = ['trialing','active','suspended','cancelled','past_due','trial_expired'];
const BILLING_TYPES = ['trial','stripe','manual','lifetime','complimentary'];

function EditModal({ tenant, onSave, onClose }: { tenant: TenantInfo; onSave: () => void; onClose: () => void }) {
  const [f, setF] = useState({
    plan_id: (tenant.plan_id as string)||'free',
    status:  (tenant.status as string)||'trialing',
    billing_email: (tenant.billing_email as string)||'',
    billing_type:  (tenant.billing_type as string)||'trial',
    manual_paid_until: tenant.manual_paid_until ? new Date(tenant.manual_paid_until as string).toISOString().split('T')[0] : '',
    trial_ends_at: tenant.trial_ends_at ? new Date(tenant.trial_ends_at as string).toISOString().split('T')[0] : '',
    admin_notes: (tenant.admin_notes as string)||'',
    primary_color: (tenant.primary_color as string)||'#7c3aed',
  });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white focus:outline-none focus:border-violet-500";

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/superadmin/tenants',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tenant.id,...f})});
    const d = await res.json();
    if(res.ok){toast.success('Updated');onSave();}else toast.error(d.error);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.85)'}}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 shadow-2xl overflow-y-auto max-h-[90vh]" style={{background:'hsl(222,28%,9%)'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <p className="text-sm font-bold text-white">{tenant.name}</p>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X className="w-4 h-4"/></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">Plan</label>
              <select value={f.plan_id} onChange={e=>setF(p=>({...p,plan_id:e.target.value}))} className={inp}>
                {PLANS.map(p=><option key={p} value={p} className="bg-slate-900 capitalize">{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Status</label>
              <select value={f.status} onChange={e=>setF(p=>({...p,status:e.target.value}))} className={inp}>
                {STATUSES.map(s=><option key={s} value={s} className="bg-slate-900 capitalize">{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Billing Type</label>
              <select value={f.billing_type} onChange={e=>setF(p=>({...p,billing_type:e.target.value}))} className={inp}>
                {BILLING_TYPES.map(b=><option key={b} value={b} className="bg-slate-900 capitalize">{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Billing Email</label>
              <input value={f.billing_email} onChange={e=>setF(p=>({...p,billing_email:e.target.value}))} className={inp} placeholder="billing@..."/>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Trial Ends</label>
              <input type="date" value={f.trial_ends_at} onChange={e=>setF(p=>({...p,trial_ends_at:e.target.value}))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Manual Paid Until</label>
              <input type="date" value={f.manual_paid_until} onChange={e=>setF(p=>({...p,manual_paid_until:e.target.value}))} className={inp}/>
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1">Admin Notes (private)</label>
            <textarea value={f.admin_notes} onChange={e=>setF(p=>({...p,admin_notes:e.target.value}))} rows={3} className={inp+' resize-none'} placeholder="Payment history, special arrangements, contact notes..."/>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 text-xs text-white/50 hover:text-white">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50">
              {saving?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<Save className="w-3.5 h-3.5"/>}Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TenantInfo {
  id: string;
  name: string;
  slug?: string;
  plan_id: string;
  plan_name?: string;
  status: string;
  billing_type?: string;
  billing_email?: string;
  stripe_customer_id?: string;
  owner_name?: string;
  owner_email?: string;
  created_at: string;
  trial_ends_at?: string;
  manual_paid_until?: string;
  primary_color?: string;
  admin_notes?: string;
  member_count?: number;
}

interface MeInfo {
  userId: string;
  ownTenantId?: string;
}

export default function SuperAdminTenantsPage() {
  const [tenants, setTenants]     = useState<TenantInfo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTenant, setEditTenant] = useState<TenantInfo | null>(null);
  const [modulesTenant, setModulesTenant] = useState<TenantInfo | null>(null);
  const [impersonating, setImpersonating] = useState<string|null>(null);
  const [meInfo, setMeInfo]       = useState<MeInfo | null>(null);
  const [form, setForm]           = useState({name:'',plan_id:'free',status:'trialing',billing_email:'',primary_color:'#7c3aed',owner_email:'',owner_name:'',owner_password:'',trial_days:'14',billing_type:'trial'});
  const [saving, setSaving]       = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500";
  const lbl = "block text-xs font-medium text-muted-foreground mb-1";

  const load = useCallback(async (abortSignal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    if (filterStatus) q.set('status', filterStatus);
    const [t, me] = await Promise.all([
      fetch('/api/superadmin/tenants?' + q, { signal: abortSignal }).then(r=>r.json()),
      fetch('/api/superadmin/me', { signal: abortSignal }).then(r=>r.json()),
    ]);
    setTenants(t.data||[]); setMeInfo(me); setLoading(false);
  }, [search, filterStatus]);

  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal);
    return () => abort.abort();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/superadmin/tenants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
    const d = await res.json();
    if(res.ok){
      toast.success(`"${form.name}" created`);
      if(d.data?.owner?.temp_password) toast(`Owner temp password: ${d.data.owner.temp_password}`,{duration:12000,icon:'🔑'});
      setShowCreate(false); setForm({name:'',plan_id:'free',status:'trialing',billing_email:'',primary_color:'#7c3aed',owner_email:'',owner_name:'',owner_password:'',trial_days:'14',billing_type:'trial'});
      load();
    } else toast.error(d.error);
    setSaving(false);
  };

  const suspend   = async (id:string,name:string) => {
    await confirmThen(`Suspend "${name}"?`, async () => {
      await fetch('/api/superadmin/tenants',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:'suspended'})});
      toast.success('Suspended'); load();
    });
  };
  const activate  = async (id:string) => { await fetch('/api/superadmin/tenants',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:'active'})}); toast.success('Activated'); load(); };
  const grantLifetime = async (id:string,name:string) => {
    await confirmThen(`Grant lifetime access to "${name}"? This sets Pro plan + active + lifetime billing.`, async () => {
      await fetch('/api/superadmin/tenants',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,plan_id:'pro',status:'active',billing_type:'lifetime'})});
      toast.success('Lifetime access granted'); load();
    });
  };
  const extendTrial = async (id:string) => {
    const days = prompt('Extend trial by how many days?','14'); if(!days) return;
    const tenant = tenants.find(t=>t.id===id);
    const base = new Date(Math.max(Date.now(), new Date(tenant?.trial_ends_at||Date.now()).getTime()));
    base.setDate(base.getDate() + parseInt(days));
    await fetch('/api/superadmin/tenants',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,trial_ends_at:base.toISOString(),status:'trialing'})});
    toast.success(`Trial extended ${days} days`); load();
  };
  const hardDelete = async (id:string,name:string) => {
    if(id===meInfo?.ownTenantId){toast.error("Can't delete your own org");return;}
    await confirmThen(`PERMANENTLY DELETE "${name}" and ALL its data?`, async () => {
      if(prompt(`Type the org name to confirm: "${name}"`)!==name){toast.error('Name mismatch');return;}
      await fetch('/api/superadmin/tenants',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,hard_delete:true})});
      toast.success('Deleted'); load();
    });
  };
  const impersonate = async (tenantId:string) => {
    setImpersonating(tenantId);
    const res = await fetch('/api/superadmin/impersonate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId})});
    const d = await res.json();
    if(res.ok) {
      // Set the impersonation session cookie
      if (d.cookie) {
        document.cookie = `session=${d.cookie}; Path=/; SameSite=Lax`;
      }
      // Flag that we're impersonating so we can show the banner
      sessionStorage.setItem('isImpersonating', 'true');
      sessionStorage.setItem('impersonateSessionId', d.sessionId || '');
      window.location.href = `/tenant/dashboard`;
    } else toast.error(d.error);
    setImpersonating(null);
  };
  const copyEmail = (email: string | undefined) => { if (email) { navigator.clipboard.writeText(email); toast.success('Copied!'); } };

  const counts = {
    total:tenants.length,
    active:tenants.filter(t=>t.status==='active').length,
    trialing:tenants.filter(t=>t.status==='trialing').length,
    suspended:tenants.filter(t=>t.status==='suspended').length,
    lifetime:tenants.filter(t=>t.billing_type==='lifetime').length,
  };

  return (
    <div className="space-y-5 max-w-7xl">
      {editTenant && <EditModal tenant={editTenant} onSave={()=>{setEditTenant(null);load();}} onClose={()=>setEditTenant(null)}/>}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2"><Building2 className="w-5 h-5 text-violet-400"/>Organizations</h1>
          <div className="flex items-center gap-3 mt-1">
            {[{l:'Total',v:counts.total},{l:'Active',v:counts.active,c:'text-emerald-400'},{l:'Trialing',v:counts.trialing,c:'text-amber-400'},{l:'Suspended',v:counts.suspended,c:'text-red-400'},{l:'Lifetime',v:counts.lifetime,c:'text-purple-400'}].map(m=>(
              <span key={m.l} className="text-xs text-muted-foreground">{m.l}: <span className={cn('font-bold text-foreground',m.c)}>{m.v}</span></span>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className="w-4 h-4"/></button>
          <button onClick={()=>setShowCreate(s=>!s)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors"><Plus className="w-4 h-4"/>New Organization</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/30"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, email..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-muted/30 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-violet-500"/>
        </div>
        <div className="flex rounded-xl border border-border overflow-hidden">
          {['','active','trialing','suspended'].map((s,i)=>(
            <button key={i} onClick={()=>setFilterStatus(s)} className={cn('px-3 py-2 text-xs font-medium transition-colors',filterStatus===s?'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400':'text-muted-foreground hover:text-foreground')}>
              {s||'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold text-foreground">New Organization</p><button onClick={()=>setShowCreate(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4"/></button></div>
          <form onSubmit={create} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><label className={lbl}>Organization Name *</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required className={inp} placeholder="Acme Corp" autoFocus/></div>
              <div><label className={lbl}>Plan</label><select value={form.plan_id} onChange={e=>setForm(f=>({...f,plan_id:e.target.value}))} className={inp}>{PLANS.map(p=><option key={p} value={p} className="bg-card capitalize">{p}</option>)}</select></div>
              <div><label className={lbl}>Status</label><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} className={inp}>{STATUSES.map(s=><option key={s} value={s} className="bg-card capitalize">{s}</option>)}</select></div>
              <div><label className={lbl}>Billing Type</label><select value={form.billing_type} onChange={e=>setForm(f=>({...f,billing_type:e.target.value}))} className={inp}>{BILLING_TYPES.map(b=><option key={b} value={b} className="bg-card capitalize">{b}</option>)}</select></div>
              <div><label className={lbl}>Trial Days</label><input type="number" value={form.trial_days} onChange={e=>setForm(f=>({...f,trial_days:e.target.value}))} className={inp} min="0"/></div>
              <div><label className={lbl}>Billing Email</label><input type="email" value={form.billing_email} onChange={e=>setForm(f=>({...f,billing_email:e.target.value}))} className={inp} placeholder="billing@..."/></div>
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Owner Account (optional — login credentials)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className={lbl}>Owner Email</label><input type="email" value={form.owner_email} onChange={e=>setForm(f=>({...f,owner_email:e.target.value}))} className={inp} placeholder="admin@acme.com"/></div>
                <div><label className={lbl}>Owner Name</label><input value={form.owner_name} onChange={e=>setForm(f=>({...f,owner_name:e.target.value}))} className={inp} placeholder="Jane Smith"/></div>
                <div><label className={lbl}>Password</label><input type="password" value={form.owner_password} onChange={e=>setForm(f=>({...f,owner_password:e.target.value}))} className={inp} placeholder="Auto-generated if empty"/></div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={()=>setShowCreate(false)} className="px-4 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50">
                {saving&&<Loader2 className="w-3.5 h-3.5 animate-spin"/>}{saving?'Creating...':'Create Organization'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            {['Organization','Owner / Contact','Plan · Billing','Status','Since · Trial','Actions'].map(h=>(
              <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading&&<tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>}
            {!loading&&!tenants.length&&<tr><td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">No organizations found</td></tr>}
            {tenants.map(t=>{
              const trialLeft = t.trial_ends_at ? Math.max(0,Math.ceil((new Date(t.trial_ends_at).getTime()-Date.now())/86400000)) : null;
              const isOwnOrg = t.id === meInfo?.ownTenantId;
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  {/* Org */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0" style={{background:t.primary_color||'#7c3aed'}}>
                        {t.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground flex items-center gap-1">
                          {t.name}
                          {isOwnOrg && <Crown className="w-3 h-3 text-amber-500"/>}
                        </p>
                        <p className="text-[10px] text-muted-foreground/50 font-mono">{t.slug}</p>
                        {t.admin_notes && <p className="text-[10px] text-amber-600/70 dark:text-amber-400/60 mt-0.5 max-w-[160px] truncate" title={t.admin_notes}>📝 {t.admin_notes}</p>}
                      </div>
                    </div>
                  </td>
                  {/* Owner contact */}
                  <td className="px-4 py-3">
                    {t.owner_name&&<p className="text-xs text-foreground/70">{t.owner_name}</p>}
                    {t.owner_email&&(
                      <button onClick={()=>copyEmail(t.owner_email)} className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3"/>{t.owner_email}
                      </button>
                    )}
                    {t.billing_email&&t.billing_email!==t.owner_email&&(
                      <button onClick={()=>copyEmail(t.billing_email)} className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 mt-0.5">
                        <DollarSign className="w-3 h-3"/>{t.billing_email}
                      </button>
                    )}
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">{t.member_count} member{t.member_count!==1?'s':''}</p>
                  </td>
                  {/* Plan + billing */}
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold text-foreground capitalize">{t.plan_name||t.plan_id}</span>
                    <p className={cn('text-[10px] capitalize mt-0.5', BILLING_TYPE_COLORS[t.billing_type||'trial']||'text-muted-foreground/50')}>{t.billing_type||'trial'}</p>
                    {t.stripe_customer_id&&<p className="text-[10px] text-muted-foreground/40 font-mono mt-0.5">Stripe ✓</p>}
                  </td>
                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full capitalize', STATUS_COLORS[t.status]||STATUS_COLORS['active'])}>{t.status}</span>
                  </td>
                  {/* Dates */}
                  <td className="px-4 py-3">
                    <p className="text-xs text-muted-foreground">{formatDate(t.created_at)}</p>
                    {t.status==='trialing'&&trialLeft!==null&&(
                      <p className={cn('text-[10px] font-bold mt-0.5', trialLeft<=0?'text-red-500':trialLeft<=3?'text-red-500':trialLeft<=7?'text-amber-500':'text-muted-foreground/60')}>
                        {trialLeft===0?'Expired!':trialLeft===1?'1 day left':`${trialLeft}d left`}
                      </p>
                    )}
                    {t.manual_paid_until&&<p className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">Paid → {formatDate(t.manual_paid_until)}</p>}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button onClick={()=>impersonate(t.id)} disabled={impersonating===t.id} title="Open as this tenant (view their CRM)"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-violet-300 transition-colors disabled:opacity-40">
                        {impersonating===t.id?<Loader2 className="w-3 h-3 animate-spin"/>:<LogIn className="w-3 h-3"/>}View
                      </button>
                      <button onClick={()=>setEditTenant(t)} title="Edit billing, plan, notes"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-violet-300/30 dark:border-violet-500/30 text-[10px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors">
                        <Edit className="w-3 h-3"/>Edit
                      </button>
                      <Link href={`/superadmin/tenants/${t.id}/roles`} title="Manage roles & permissions"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-violet-300/30 dark:border-violet-500/30 text-[10px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors">
                        <Shield className="w-3 h-3"/>Roles
                      </Link>
                      <button onClick={()=>setModulesTenant(t)} title="Manage modules for this tenant"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-violet-300/30 dark:border-violet-500/30 text-[10px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors">
                        <Zap className="w-3 h-3"/>Modules
                      </button>
                      {t.status==='trialing'&&(
                        <button onClick={()=>extendTrial(t.id)} title="Extend trial"
                          className="px-2 py-1 rounded-lg border border-amber-300/30 dark:border-amber-500/30 text-[10px] text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors">+Days</button>
                      )}
                      {t.billing_type!=='lifetime'&&(
                        <button onClick={()=>grantLifetime(t.id,t.name)} title="Grant lifetime access"
                          className="px-2 py-1 rounded-lg border border-purple-300/30 dark:border-purple-500/30 text-[10px] text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-colors">
                          <Crown className="w-3 h-3"/>
                        </button>
                      )}
                      {t.status!=='suspended'?(
                        <button onClick={()=>suspend(t.id,t.name)} className="px-2 py-1 rounded-lg border border-red-300/20 dark:border-red-500/20 text-[10px] text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">Suspend</button>
                      ):(
                        <button onClick={()=>activate(t.id)} className="px-2 py-1 rounded-lg border border-emerald-300/20 dark:border-emerald-500/20 text-[10px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors">Activate</button>
                      )}
                      {!isOwnOrg&&(
                        <button onClick={()=>hardDelete(t.id,t.name)} title="Delete permanently" className="p-1 rounded-lg text-muted-foreground/30 hover:text-red-500 hover:bg-red-500/10 transition-colors">
                          <Trash2 className="w-3.5 h-3.5"/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editTenant && <EditModal tenant={editTenant} onSave={()=>{setEditTenant(null);load();}} onClose={()=>setEditTenant(null)} />}
      {modulesTenant && <ModulesModal tenant={modulesTenant} onClose={()=>setModulesTenant(null)} _onSaved={()=>{setModulesTenant(null);load();}} />}
    </div>
  );
}

function ModulesModal({ tenant, onClose, _onSaved }: { tenant: any; onClose: () => void; _onSaved: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [modules, setModules] = useState<any[]>([]);
  const [plan, setPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/superadmin/tenants/${tenant.id}/modules`);
    const d = await res.json();
    setModules(d.data || []);
    setPlan(d.plan || 'free');
    setLoading(false);
  }, [tenant.id]);
  useEffect(() => { load(); }, [load]);

  const toggleModule = async (mod: { id: string; status: string; planAllowed: boolean }) => {
    setToggling(mod.id);
    const action = mod.status === 'active' ? 'disable' : 'install';
    const res = await fetch(`/api/superadmin/tenants/${tenant.id}/modules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module_id: mod.id, action, force_enabled: !mod.planAllowed }),
    });
    if (res.ok) {
      toast.success(action === 'install' ? 'Module enabled' : 'Module disabled');
      load();
    } else { const d = await res.json(); toast.error(d.error); }
    setToggling(null);
  };

  const CAT_COLORS: Record<string, string> = {
    utility: 'bg-white/5 text-white/40',
    automation: 'bg-violet-500/15 text-violet-400',
    messaging: 'bg-emerald-500/15 text-emerald-400',
    integration: 'bg-blue-500/15 text-blue-400',
    ai: 'bg-amber-500/15 text-amber-400',
    analytics: 'bg-orange-500/15 text-orange-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl overflow-y-auto max-h-[90vh]" style={{ background: 'hsl(222,28%,9%)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 z-10" style={{ background: 'hsl(222,28%,9%)' }}>
          <div>
            <p className="text-sm font-bold text-white">{tenant.name} — Modules</p>
            <p className="text-xs text-white/40">Plan: <span className="capitalize font-semibold">{plan}</span></p>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-2">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse bg-white/5" />
            ))
          ) : modules.length === 0 ? (
            <p className="text-center text-white/30 py-8 text-sm">No modules available</p>
          ) : (
            modules.map(mod => {
              const isActive = mod.status === 'active';
              const planBlocks = !mod.planAllowed && !isActive;
              return (
                <div key={mod.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-lg mt-0.5">{mod.icon || '🔌'}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white">{mod.name}</p>
                        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize', CAT_COLORS[mod.category ?? ''] || CAT_COLORS['utility'])}>
                          {mod.category}
                        </span>
                      </div>
                      <p className="text-xs text-white/40 mt-0.5">{mod.description}</p>
                      {planBlocks && (
                        <p className="text-[10px] text-amber-400/70 mt-1">Not included in {plan} plan — force-enable as override</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleModule(mod)}
                    disabled={toggling === mod.id}
                    className={cn('flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors shrink-0 ml-3 disabled:opacity-50',
                      isActive
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                        : planBlocks
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                          : 'border-white/10 bg-white/5 text-white/30 hover:text-white'
                    )}>
                    {toggling === mod.id ? '...' : isActive ? 'Active' : planBlocks ? 'Override' : 'Install'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
