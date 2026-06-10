'use client';
import { useState, useEffect } from 'react';
import { Megaphone, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

const TYPE_CFG: Record<string,{badge:string;border:string}> = {
  info:        { badge:'bg-blue-500/15 text-blue-400',    border:'border-blue-500/20' },
  warning:     { badge:'bg-amber-500/15 text-amber-400',  border:'border-amber-500/20' },
  maintenance: { badge:'bg-orange-500/15 text-orange-400',border:'border-orange-500/20' },
  critical:    { badge:'bg-red-500/15 text-red-400',      border:'border-red-500/20' },
};

export default function AnnouncementsPage() {
  const [items, setItems]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]     = useState({ title:'', body:'', type:'info', target:'all', is_active:true, ends_at:'' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500";

  const load = async () => { const d = await fetch('/api/superadmin/announcements').then(r=>r.json()); setItems(d.data||[]); setLoading(false); };
  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/superadmin/announcements',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(form) });
    const d = await res.json();
    if (res.ok) { toast.success('Announcement created'); setShowForm(false); setForm({title:'',body:'',type:'info',target:'all',is_active:true,ends_at:''}); load(); }
    else toast.error(d.error||'Failed');
    setSaving(false);
  };

  const toggle = async (id: string, is_active: boolean) => {
    await fetch('/api/superadmin/announcements',{ method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id,is_active}) });
    setItems(prev => prev.map(a => a.id===id?{...a,is_active}:a));
  };

  const del = async (id: string) => {
      await fetch('/api/superadmin/announcements',{ method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) });
    setItems(prev => prev.filter(a => a.id!==id));
    toast.success('Deleted');
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><Megaphone className="w-5 h-5 text-violet-400"/>Platform Announcements</h1>
          <p className="text-xs text-white/30">Banners shown to tenants across the platform</p>
        </div>
        <button onClick={()=>setShowForm(s=>!s)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4"/>{showForm?'Cancel':'New Announcement'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <p className="text-sm font-semibold text-white">New Announcement</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-white/50 mb-1">Title *</label>
              <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required className={inp} placeholder="Scheduled maintenance window"/>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-white/50 mb-1">Message</label>
              <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={3} className={inp+' resize-none'} placeholder="Detailed message for your tenants..."/>
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Type</label>
              <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} className={inp}>
                {['info','warning','maintenance','critical'].map(t=><option key={t} value={t} className="bg-slate-900 capitalize">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Target</label>
              <select value={form.target} onChange={e=>setForm(f=>({...f,target:e.target.value}))} className={inp}>
                {['all','admins','trialing','paid'].map(t=><option key={t} value={t} className="bg-slate-900">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Expires At (optional)</label>
              <input type="datetime-local" value={form.ends_at} onChange={e=>setForm(f=>({...f,ends_at:e.target.value}))} className={inp}/>
            </div>
            <div className="flex items-center gap-2 mt-5">
              <input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))} className="accent-violet-500 w-4 h-4"/>
              <label className="text-xs text-white/60">Active immediately</label>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
            <button type="button" onClick={()=>setShowForm(false)} className="px-4 py-2 rounded-xl border border-white/10 text-xs text-white/50 hover:text-white">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50">{saving?'Saving...':'Publish'}</button>
          </div>
        </form>
      )}

      {/* Announcements list */}
      {loading ? <p className="text-white/30 text-sm">Loading...</p>
      : !items.length ? (
        <div className="text-center py-12">
          <Megaphone className="w-10 h-10 text-white/10 mx-auto mb-3"/>
          <p className="text-white/30 text-sm">No announcements yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(a => {
            const cfg = TYPE_CFG[a.type] || TYPE_CFG['info'];
            if (!cfg) return null;
            return (
              <div key={a.id} className={cn('rounded-xl border p-4 transition-all', cfg.border, a.is_active?'bg-white/[0.03]':'bg-white/[0.01] opacity-60')}>
                <div className="flex items-start gap-3">
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 mt-0.5', cfg.badge)}>{a.type}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{a.title}</p>
                    {a.body && <p className="text-xs text-white/50 mt-1">{a.body}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/25">
                      <span>Target: {a.target}</span>
                      {a.ends_at && <span>Expires: {formatDate(a.ends_at)}</span>}
                      <span>{a.is_active?'Active':'Inactive'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={()=>toggle(a.id,!a.is_active)} title={a.is_active?'Deactivate':'Activate'}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors">
                      {a.is_active?<EyeOff className="w-3.5 h-3.5"/>:<Eye className="w-3.5 h-3.5"/>}
                    </button>
                    <button onClick={()=>del(a.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
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
