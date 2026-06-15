'use client';
import { useState, useEffect } from 'react';
import { Shield, Plus, Edit, Trash2, Save, Lock, ChevronDown, Check, Crown } from 'lucide-react';
import { PERMISSIONS, PERMISSION_CATEGORIES } from '@/lib/permissions/definitions';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const DANGER_COLORS = { safe:'text-emerald-500', moderate:'text-amber-500', danger:'text-red-500' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RoleEditor({ role, onSave, onClose }: any) {
  const [name, setName] = useState(role?.name||'');
  const [description, setDescription] = useState(role?.description||'');
  const [permissions, setPermissions] = useState<Record<string,boolean>>(role?.permissions||{});
  const [saving, setSaving] = useState(false);
  const [openCat, setOpenCat] = useState<string|null>(PERMISSION_CATEGORIES[0] ?? null);
  const toggle = (id: string) => setPermissions(p => ({...p, [id]: !p[id]}));
  const setCatAll = (cat: string, val: boolean) => { const ps = PERMISSIONS.filter(p => p.category===cat); setPermissions(prev => { const n={...prev}; ps.forEach(p => { n[p.id]=val; }); return n; }); };
  const granted = Object.values(permissions).filter(Boolean).length;

  const save = async () => {
    if (!name.trim()) { toast.error('Name required'); return; }
    setSaving(true);
    const url = role?.id ? `/api/tenant/roles/${role.id}` : '/api/tenant/roles';
    const res = await fetch(url, { method: role?.id ? 'PATCH' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, description, permissions }) });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error||'Failed'); setSaving(false); return; }
    toast.success(role?.id ? 'Role updated' : 'Role created');
    onSave(data.data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-h-[90vh] flex flex-col animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div><h2 className="font-semibold">{role?.id ? `Edit: ${role.name}` : 'New Role'}</h2><p className="text-xs text-muted-foreground">{granted}/{PERMISSIONS.length} permissions</p></div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Role Name</label><input value={name} onChange={e => setName(e.target.value)} disabled={role?.slug==='admin'} className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60" /></div>
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Description</label><input value={description} onChange={e => setDescription(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
          </div>
          {PERMISSION_CATEGORIES.map(cat => {
            const catPs = PERMISSIONS.filter(p => p.category===cat);
            const catGranted = catPs.filter(p => permissions[p.id]).length;
            const open = openCat===cat;
            return (
              <div key={cat} className="border border-border rounded-xl overflow-hidden">
                <button onClick={() => setOpenCat(open?null:cat)} className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-accent transition-colors">
                  <div className="flex items-center gap-3"><Shield className="w-4 h-4 text-violet-500" /><span className="text-sm font-semibold">{cat}</span><span className="text-xs text-muted-foreground">{catGranted}/{catPs.length}</span></div>
                  <div className="flex items-center gap-2">
                    {role.slug!=='admin' && <><button type="button" onClick={e => {e.stopPropagation();setCatAll(cat,true);}} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">All</button><button type="button" onClick={e => {e.stopPropagation();setCatAll(cat,false);}} className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400">None</button></>}
                    <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open&&'rotate-180')} />
                  </div>
                </button>
                {open && <div className="divide-y divide-border">
                  {catPs.map(perm => {
                    const g = permissions[perm.id]||false;
                    return (
                      <div key={perm.id} className={cn('flex items-center gap-3 px-4 py-3 transition-colors', g?'bg-emerald-50/50 dark:bg-emerald-950/10':'hover:bg-accent/50')}>
                        <button type="button" onClick={() => role.slug!=='admin' && toggle(perm.id)} disabled={role?.slug==='admin'}
                          className={cn('w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shrink-0', g?'bg-emerald-500 border-emerald-500':'border-border hover:border-violet-400', role?.slug==='admin'&&'opacity-60 cursor-not-allowed')}>
                          {g && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <div className="flex-1"><p className="text-sm font-medium">{perm.label}</p><p className="text-xs text-muted-foreground">{perm.description}</p></div>
                        <span className={cn('text-[10px] font-semibold', DANGER_COLORS[perm.dangerLevel])}>{perm.dangerLevel==='danger'?'⚠ Destructive':perm.dangerLevel==='moderate'?'● Write':'● Read'}</span>
                      </div>
                    );
                  })}
                </div>}
              </div>
            );
          })}
        </div>
        <div className="flex gap-3 p-5 border-t border-border shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
          <button onClick={save} disabled={saving||role?.slug==='admin'} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
            <Save className="w-3.5 h-3.5" />{saving?'Saving...':'Save Role'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RolesPermissionsPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editRole, setEditRole] = useState<any>(null);
  const [showEditor, setShowEditor] = useState(false);

  const load = async () => {
    const res = await fetch('/api/tenant/roles');
    const data = await res.json();
    setRoles(data.data||[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const del = async (id: string) => {
    await fetch(`/api/tenant/roles/${id}`, { method: 'DELETE' });
    setRoles(prev => prev.filter(r => r.id!==id));
    toast.success('Deleted');
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h1 className="text-lg font-bold">Roles & Permissions</h1><p className="text-sm text-muted-foreground">Control what each role can do</p></div>
        <button onClick={() => { setEditRole(null); setShowEditor(true); }} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"><Plus className="w-4 h-4" />New Role</button>
      </div>
      {loading ? <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div> : (
        <div className="space-y-3">
          {roles.map(role => {
            const g = role.permissions?.all ? PERMISSIONS.length : Object.values(role.permissions||{}).filter(Boolean).length;
            return (
              <div key={role.id} className="admin-card p-5 group hover:border-violet-400/30 transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center shrink-0">
                      {role.slug==='admin' ? <Crown className="w-5 h-5 text-amber-500" /> : <Shield className="w-5 h-5 text-violet-600" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{role.name}</p>
                        {['admin','manager','sales','viewer'].includes(role.slug) && <span className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full flex items-center gap-1"><Lock className="w-2.5 h-2.5" />System</span>}
                      </div>
                      {role.description && <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{role.permissions?.all ? `All ${PERMISSIONS.length}` : g} permission{g!==1?'s':''}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 ml-3 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditRole(role); setShowEditor(true); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"><Edit className="w-3 h-3" />{['admin','manager','sales','viewer'].includes(role.slug)?'View':'Edit'}</button>
                    {!['admin','manager','sales','viewer'].includes(role.slug) && <button onClick={() => del(role.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 dark:hover:text-red-400 text-muted-foreground transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showEditor && <RoleEditor role={editRole} onSave={() => { load(); setShowEditor(false); }} onClose={() => setShowEditor(false)} />}
    </div>
  );
}
