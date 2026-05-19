'use client';
import { useState, useEffect } from 'react';
import { CreditCard, Plus, Edit, Trash2, CheckCircle, X, Save, Loader2, Users, Database, Zap, Crown } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

const FEATURE_OPTIONS = ['contacts','deals','tasks','automations','forms','reports','sequences','products','quotes','ai','api_access','custom_roles','custom_domain','sso','audit_logs','dedicated_support'];

function PlanForm({ plan, onSave, onClose }: { plan?: any; onSave: () => void; onClose: () => void }) {
  const [f, setF] = useState({
    id: plan?.id || '', name: plan?.name || '', price_monthly: plan?.price_monthly || 0,
    price_yearly: plan?.price_yearly || 0, max_users: plan?.max_users || 5,
    max_contacts: plan?.max_contacts || 1000, max_deals: plan?.max_deals || 500,
    max_automations: plan?.max_automations || 5, max_forms: plan?.max_forms || 3,
    max_api_calls_day: plan?.max_api_calls_day || 1000, max_storage_gb: plan?.max_storage_gb || 1,
    features: plan?.features || [], sort_order: plan?.sort_order || 99,
  });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500";

  const toggleFeature = (feat: string) => setF(p => ({
    ...p, features: p.features.includes(feat) ? p.features.filter((x:string)=>x!==feat) : [...p.features, feat],
  }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const method = plan ? 'PATCH' : 'POST';
    const body = plan ? { ...f, id: plan.id } : f;
    const res = await fetch('/api/superadmin/plans', { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await res.json();
    if (res.ok) { toast.success(plan ? 'Plan updated' : 'Plan created'); onSave(); onClose(); }
    else toast.error(d.error || 'Failed');
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.8)'}}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl" style={{background:'hsl(222,28%,9%)'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <p className="text-sm font-bold text-white">{plan ? 'Edit Plan' : 'Create Plan'}</p>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X className="w-4 h-4"/></button>
        </div>
        <form onSubmit={save} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {!plan && <div><label className="block text-xs font-medium text-white/50 mb-1">Plan ID (unique slug)</label><input value={f.id} onChange={e=>setF(p=>({...p,id:e.target.value.toLowerCase().replace(/\s+/g,'-')}))} required className={inp} placeholder="pro-plus"/></div>}
            <div className={plan?'col-span-2':''}><label className="block text-xs font-medium text-white/50 mb-1">Display Name</label><input value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))} required className={inp} placeholder="Pro"/></div>
            <div><label className="block text-xs font-medium text-white/50 mb-1">Monthly Price ($)</label><input type="number" value={f.price_monthly} onChange={e=>setF(p=>({...p,price_monthly:Number(e.target.value)}))} min="0" className={inp}/></div>
            <div><label className="block text-xs font-medium text-white/50 mb-1">Yearly Price ($)</label><input type="number" value={f.price_yearly} onChange={e=>setF(p=>({...p,price_yearly:Number(e.target.value)}))} min="0" className={inp}/></div>
          </div>
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">Limits <span className="text-white/20 normal-case">(use -1 for unlimited)</span></p>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['max_users','Users'],['max_contacts','Contacts'],['max_deals','Deals'],
                ['max_automations','Automations'],['max_forms','Forms'],['max_api_calls_day','API Calls/day'],['max_storage_gb','Storage (GB)'],
              ].map(([key,label]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-white/40 mb-1">{label}</label>
                  <input type="number" value={(f as any)[key as string]} onChange={e=>setF(p=>({...p,[key as string]:Number(e.target.value)}))} className={inp}/>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">Features</p>
            <div className="flex flex-wrap gap-2">
              {FEATURE_OPTIONS.map(feat => (
                <button key={feat} type="button" onClick={()=>toggleFeature(feat)}
                  className={cn('px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors capitalize', f.features.includes(feat)?'border-violet-500/50 bg-violet-500/20 text-violet-400':'border-white/10 text-white/30 hover:text-white/60')}>
                  {feat.replace(/_/g,' ')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2 border-t border-white/10 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 text-xs text-white/50 hover:text-white">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50">
              {saving?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<Save className="w-3.5 h-3.5"/>}{saving?'Saving...':'Save Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPlan, setEditPlan] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const [p, t] = await Promise.all([
      fetch('/api/superadmin/plans').then(r=>r.json()),
      fetch('/api/superadmin/tenants').then(r=>r.json()),
    ]);
    setPlans(p.data||[]); setTenants(t.data||[]); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const planCounts: Record<string,{active:number;trialing:number}> = {};
  tenants.forEach(t => {
    if (!planCounts[t.plan_id]) planCounts[t.plan_id]={active:0,trialing:0};
    if (t.status==='active') planCounts[t.plan_id]!.active++;
    if (t.status==='trialing') planCounts[t.plan_id]!.trialing++;
  });

  const PLAN_ICONS: Record<string,any> = { free:Users, starter:Zap, pro:Crown, enterprise:Crown };
  const PLAN_COLORS: Record<string,string> = { free:'text-white/40', starter:'text-blue-400', pro:'text-violet-400', enterprise:'text-amber-400' };

  return (
    <div className="space-y-5 max-w-6xl">
      {(editPlan || creating) && <PlanForm plan={editPlan} onSave={load} onClose={()=>{setEditPlan(null);setCreating(false);}}/>}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><CreditCard className="w-5 h-5 text-violet-400"/>Plans & Billing</h1>
          <p className="text-xs text-white/30">Manage subscription plans and features</p>
        </div>
        <button onClick={()=>setCreating(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4"/>New Plan
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_,i)=><div key={i} className="rounded-xl border border-white/10 h-60 animate-pulse bg-white/5"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map(plan => {
            const Icon = PLAN_ICONS[plan.id] || Zap;
            const counts = planCounts[plan.id] || {active:0,trialing:0};
            return (
              <div key={plan.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex flex-col">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={cn('w-4 h-4', PLAN_COLORS[plan.id]||'text-white/40')}/>
                      <p className="font-bold text-white capitalize">{plan.name}</p>
                    </div>
                    <p className={cn('text-xl font-bold', PLAN_COLORS[plan.id]||'text-white/40')}>
                      {plan.price_monthly>0?`$${plan.price_monthly}/mo`:'Free'}
                    </p>
                    {plan.price_yearly>0&&<p className="text-xs text-white/30">${plan.price_yearly}/yr</p>}
                  </div>
                  <button onClick={()=>setEditPlan(plan)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors">
                    <Edit className="w-3.5 h-3.5"/>
                  </button>
                </div>
                <div className="space-y-1.5 text-xs text-white/40 flex-1">
                  {[
                    ['Users', plan.max_users<0?'Unlimited':plan.max_users],
                    ['Contacts', plan.max_contacts<0?'Unlimited':plan.max_contacts?.toLocaleString()],
                    ['Deals', plan.max_deals<0?'Unlimited':plan.max_deals?.toLocaleString()],
                    ['API calls/day', plan.max_api_calls_day<0?'Unlimited':plan.max_api_calls_day?.toLocaleString()],
                  ].map(([label,value]) => (
                    <div key={label} className="flex justify-between">
                      <span>{label}</span><span className="text-white/60 font-medium">{value}</span>
                    </div>
                  ))}
                </div>
                {plan.features?.length>0 && (
                  <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-white/5">
                    {(plan.features||[]).slice(0,4).map((f:string)=>(
                      <span key={f} className="text-[9px] bg-white/5 text-white/30 px-1.5 py-0.5 rounded capitalize">{f.replace(/_/g,' ')}</span>
                    ))}
                    {(plan.features||[]).length>4&&<span className="text-[9px] text-white/20">+{plan.features.length-4}</span>}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-1.5 text-center text-xs">
                  <div className="rounded-lg bg-emerald-500/10 py-1.5">
                    <p className="font-bold text-emerald-400">{counts.active}</p>
                    <p className="text-white/30 text-[10px]">Active</p>
                  </div>
                  <div className="rounded-lg bg-amber-500/10 py-1.5">
                    <p className="font-bold text-amber-400">{counts.trialing}</p>
                    <p className="text-white/30 text-[10px]">Trialing</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
