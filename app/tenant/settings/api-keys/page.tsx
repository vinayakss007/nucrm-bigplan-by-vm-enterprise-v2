'use client';
import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Copy, CheckCircle } from 'lucide-react';
import { cn, formatDate, formatRelativeTime, apiFetch } from '@/lib/utils';
import toast from 'react-hot-toast';

const SCOPES = ['contacts:read','contacts:write','deals:read','deals:write','tasks:read','tasks:write','companies:read'];

export default function APIKeysPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [keys, setKeys]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState({ name:'', scopes:[] as string[], expires_days:'' });
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey]   = useState<string|null>(null);
  const [copied, setCopied]   = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = () => fetch('/api/tenant/api-keys').then(r=>r.json()).then(d=>{setKeys(d.data??[]);setLoading(false);});
  useEffect(()=>{load();},[]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setCreating(true);
    const res = await apiFetch('/api/tenant/api-keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
    const data = await res.json();
    if (!res.ok){toast.error(data.error);setCreating(false);return;}
    setNewKey(data.key);
    setShowForm(false);
    setForm({name:'',scopes:[],expires_days:''});
    load(); setCreating(false);
  };

  const del = async (id:string) => {
      await apiFetch(`/api/tenant/api-keys/${id}`,{method:'DELETE'});
    toast.success('Key revoked'); load();
  };

  const copy = (text:string) => {
    navigator.clipboard.writeText(text);
    setCopied(true); toast.success('Copied!');
    setTimeout(()=>setCopied(false),2000);
  };

  const toggleScope = (s:string) => setForm(f=>({...f, scopes: f.scopes.includes(s)?f.scopes.filter(x=>x!==s):[...f.scopes,s]}));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h1 className="text-lg font-bold flex items-center gap-2"><Key className="w-5 h-5" />API Keys</h1><p className="text-sm text-muted-foreground">Generate keys to integrate NuCRM with external tools</p></div>
        <button onClick={()=>setShowForm(s=>!s)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors"><Plus className="w-4 h-4" />New Key</button>
      </div>

      {/* New key reveal */}
      {newKey && (
        <div className="admin-card p-5 border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle className="w-4 h-4" /><p className="text-sm font-semibold">API key created — save it now!</p>
          </div>
          <p className="text-xs text-muted-foreground">This key will never be shown again. Copy it immediately.</p>
          <div className="flex items-center gap-2 bg-muted rounded-xl p-3 font-mono text-xs">
            <code className="flex-1 break-all">{newKey}</code>
            <button onClick={()=>copy(newKey)} className="shrink-0 p-1.5 rounded hover:bg-accent transition-colors">
              {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={()=>setNewKey(null)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={create} className="admin-card p-5 space-y-4">
          <h3 className="font-semibold text-sm">New API Key</h3>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Key Name *</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required placeholder="e.g. Zapier Integration" className={inp} autoFocus /></div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Permissions</label>
            <div className="flex flex-wrap gap-2">
              {SCOPES.map(s=>(
                <button key={s} type="button" onClick={()=>toggleScope(s)}
                  className={cn('px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',form.scopes.includes(s)?'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border-violet-300 dark:border-violet-700':'border-border text-muted-foreground hover:bg-accent')}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Expires After (days, optional)</label><input type="number" value={form.expires_days} onChange={e=>setForm(f=>({...f,expires_days:e.target.value}))} placeholder="Never" className={inp} min="1" /></div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating} className="flex-1 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors">{creating?'Creating...':'Create Key'}</button>
            <button type="button" onClick={()=>setShowForm(false)} className="flex-1 py-2 rounded-xl border border-border text-sm hover:bg-accent transition-colors">Cancel</button>
          </div>
        </form>
      )}

      {/* Keys list */}
      <div className="admin-card overflow-hidden">
        {loading ? <p className="text-sm text-muted-foreground p-5">Loading...</p>
        : !keys.length ? (
          <div className="py-12 text-center"><Key className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" /><p className="text-sm text-muted-foreground">No API keys yet</p></div>
        ) : (
          <div className="divide-y divide-border">
            {keys.map(k=>(
              <div key={k.id} className="flex items-start gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><p className="text-sm font-semibold">{k.name}</p>{!k.is_active&&<span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">Revoked</span>}</div>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">{k.key_prefix}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>Created {formatDate(k.created_at)}</span>
                    {k.last_used_at&&<span>Last used {formatRelativeTime(k.last_used_at)}</span>}
                    {k.expires_at&&<span>Expires {formatDate(k.expires_at)}</span>}
                  </div>
                  {k.scopes?.length>0&&<div className="flex flex-wrap gap-1 mt-1.5">{k.scopes.map((s:string)=><span key={s} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{s}</span>)}</div>}
                </div>
                <button onClick={()=>del(k.id)} className="p-1.5 rounded hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 text-muted-foreground transition-colors shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-card p-4 bg-muted/30">
        <p className="text-xs font-semibold mb-2">Using API Keys</p>
        <p className="text-xs text-muted-foreground mb-2">Include your key in the <code className="font-mono bg-muted px-1 rounded">Authorization</code> header:</p>
        <code className="text-xs font-mono bg-muted block p-2 rounded-lg">Authorization: Bearer ak_live_...</code>
      </div>
    </div>
  );
}
