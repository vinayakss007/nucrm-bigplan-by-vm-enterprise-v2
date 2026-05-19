'use client';
import { useState, useEffect } from 'react';
import { Plus, Globe, Check, X, Trash2, Loader2, ChevronDown, CheckCircle, XCircle, Clock, Copy } from 'lucide-react';
import { cn, formatRelativeTime, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

const WEBHOOK_EVENTS = [
  'contact.created','contact.updated','contact.deleted',
  'deal.created','deal.updated','deal.stage_changed','deal.won','deal.lost',
  'task.created','task.completed','form.submitted',
];

export default function WebhooksPage() {
  const [webhooks, setWebhooks]   = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit]   = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<any>(null);
  const [expanded, setExpanded]   = useState<string|null>(null);
  const [deliveries, setDeliveries] = useState<Record<string,any[]>>({});
  const [saving, setSaving]       = useState(false);
  const [form, setForm]           = useState({ name:'', url:'', events:[] as string[] });
  const [secretVisible, setSecretVisible] = useState<Record<string,string>>({});
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/tenant/webhooks');
    if (res.ok) { const d = await res.json(); setWebhooks(d.data ?? []); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const loadDeliveries = async (id: string) => {
    if (deliveries[id]) return;
    const res = await fetch(`/api/tenant/webhooks/${id}/deliveries`);
    if (res.ok) { const d = await res.json(); setDeliveries(p => ({...p, [id]:d.data??[]})); }
  };

  const toggleExpand = (id: string) => {
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (next) loadDeliveries(next);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/webhooks', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success('Webhook created');
      if (d.data?.signing_secret) {
        setSecretVisible(p => ({...p, [d.data.id]: d.data.signing_secret}));
      }
      setShowCreate(false); setForm({ name:'', url:'', events:[] }); load();
    } else toast.error(d.error);
    setSaving(false);
  };

  const edit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch(`/api/tenant/webhooks/${editingWebhook.id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success('Webhook updated');
      setShowEdit(false); setEditingWebhook(null); setForm({ name:'', url:'', events:[] }); load();
    } else toast.error(d.error);
    setSaving(false);
  };

  const startEdit = (wh: any) => {
    setEditingWebhook(wh);
    setForm({ name: wh.name, url: wh.url, events: wh.events || [] });
    setShowEdit(true);
  };

  const toggleEvent = (event: string) =>
    setForm(f => ({...f, events: f.events.includes(event) ? f.events.filter(e => e !== event) : [...f.events, event]}));

  const toggleActive = async (id: string, current: boolean) => {
    await fetch(`/api/tenant/webhooks/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ is_active: !current }) });
    setWebhooks(w => w.map(x => x.id === id ? {...x, is_active: !current} : x));
  };

  const del = async (id: string) => {
    await fetch(`/api/tenant/webhooks/${id}`, { method:'DELETE' });
    setWebhooks(w => w.filter(x => x.id !== id));
    toast.success('Deleted');
  };

  const copySecret = (id: string) => {
    const secret = secretVisible[id];
    if (secret) navigator.clipboard.writeText(secret);
    toast.success('Signing secret copied');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Webhooks</h1>
          <p className="text-sm text-muted-foreground">Send real-time events to external services when things happen in NuCRM</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4"/>Add Webhook
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">New Webhook</h3>
            <button onClick={() => setShowCreate(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <form onSubmit={create} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({...f, name:e.target.value}))} required className={inp} placeholder="e.g. Zapier Integration" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Endpoint URL *</label>
              <input type="url" value={form.url} onChange={e => setForm(f => ({...f, url:e.target.value}))} required className={inp} placeholder="https://hooks.zapier.com/..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-3">Events to listen to</label>
              <div className="grid grid-cols-2 gap-2">
                {WEBHOOK_EVENTS.map(event => (
                  <label key={event} className={cn('flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm',
                    form.events.includes(event) ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/20' : 'border-border hover:bg-accent')}>
                    <input type="checkbox" checked={form.events.includes(event)} onChange={() => toggleEvent(event)} className="hidden" />
                    <div className={cn('w-4 h-4 rounded border flex items-center justify-center',
                      form.events.includes(event) ? 'bg-violet-600 border-violet-600' : 'border-border')}>
                      {form.events.includes(event) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className="text-xs font-mono">{event}</span>
                  </label>
                ))}
              </div>
              {form.events.length === 0 && <p className="text-xs text-muted-foreground mt-2">Select at least one event to listen for</p>}
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
              <button type="submit" disabled={saving||!form.name||!form.url||!form.events.length}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Create Webhook
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit form */}
      {showEdit && editingWebhook && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Edit Webhook</h3>
            <button onClick={() => { setShowEdit(false); setEditingWebhook(null); }}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <form onSubmit={edit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({...f, name:e.target.value}))} required className={inp} placeholder="e.g. Zapier Integration" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Endpoint URL *</label>
              <input type="url" value={form.url} onChange={e => setForm(f => ({...f, url:e.target.value}))} required className={inp} placeholder="https://hooks.zapier.com/..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-3">Events to listen to</label>
              <div className="grid grid-cols-2 gap-2">
                {WEBHOOK_EVENTS.map(event => (
                  <label key={event} className={cn('flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm',
                    form.events.includes(event) ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/20' : 'border-border hover:bg-accent')}>
                    <input type="checkbox" checked={form.events.includes(event)} onChange={() => toggleEvent(event)} className="hidden" />
                    <div className={cn('w-4 h-4 rounded border flex items-center justify-center',
                      form.events.includes(event) ? 'bg-violet-600 border-violet-600' : 'border-border')}>
                      {form.events.includes(event) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className="text-xs font-mono">{event}</span>
                  </label>
                ))}
              </div>
              {form.events.length === 0 && <p className="text-xs text-muted-foreground mt-2">Select at least one event to listen for</p>}
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowEdit(false); setEditingWebhook(null); }} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
              <button type="submit" disabled={saving||!form.name||!form.url||!form.events.length}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Update Webhook
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Webhook list */}
      {loading ? [...Array(2)].map((_,i) => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />) :
      webhooks.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Globe className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No webhooks</p>
          <p className="text-sm text-muted-foreground mt-1">Connect NuCRM to Zapier, Make, or any external service</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
            <Plus className="w-4 h-4"/>Add Webhook
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map(wh => (
            <div key={wh.id} className="rounded-2xl border border-border bg-card overflow-hidden">
              {/* Secret banner (shown once after creation) */}
              {secretVisible[wh.id] && (
                <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 px-4 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">Save your signing secret — shown once!</p>
                    <code className="text-xs font-mono text-amber-700 dark:text-amber-500">{secretVisible[wh.id]}</code>
                  </div>
                  <button onClick={() => copySecret(wh.id)} className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-700">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setSecretVisible(p => { const q = {...p}; delete q[wh.id]; return q; })} className="text-amber-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                    wh.is_active ? 'bg-emerald-100 dark:bg-emerald-950/40' : 'bg-muted')}>
                    <Globe className={cn('w-4 h-4', wh.is_active ? 'text-emerald-600' : 'text-muted-foreground')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{wh.name}</p>
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                        wh.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground')}>
                        {wh.is_active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{wh.url}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="text-emerald-600 font-medium">{wh.delivered_count ?? 0} delivered</span>
                      {(wh.failed_count ?? 0) > 0 && <span className="text-red-500 font-medium">{wh.failed_count} failed</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => startEdit(wh)} className="text-xs font-medium text-muted-foreground hover:text-violet-600 border border-border rounded-lg px-2.5 py-1 hover:border-violet-300 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => toggleActive(wh.id, wh.is_active)} className="text-xs font-medium text-muted-foreground hover:text-violet-600 border border-border rounded-lg px-2.5 py-1 hover:border-violet-300 transition-colors">
                      {wh.is_active ? 'Pause' : 'Enable'}
                    </button>
                    <button onClick={() => toggleExpand(wh.id)} className="text-muted-foreground hover:text-foreground">
                      <ChevronDown className={cn('w-4 h-4 transition-transform', expanded === wh.id && 'rotate-180')} />
                    </button>
                    <button onClick={() => del(wh.id)} className="text-muted-foreground hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Delivery log */}
                {expanded === wh.id && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Recent Deliveries</p>
                    {(() => {
                      const dels = deliveries[wh.id];
                      if (!dels) return <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
                      if (dels.length === 0) return <p className="text-xs text-muted-foreground py-2">No deliveries yet</p>;
                      return (
                        <div className="space-y-1.5">
                          {dels.map((d: any) => (
                          <div key={d.id} className="flex items-center gap-3 text-xs">
                            {d.status === 'delivered'
                              ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              : d.status === 'failed'
                              ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                              : <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                            <span className="font-mono text-muted-foreground">{d.event}</span>
                            {d.response_code && <span className={cn('px-1.5 py-0.5 rounded font-mono font-bold',
                              d.response_code < 300 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                              {d.response_code}
                            </span>}
                            <span className="text-muted-foreground ml-auto">{formatRelativeTime(d.created_at)}</span>
                          </div>
                        ))}
                      </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Documentation */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
            <h4 className="text-sm font-semibold">Webhook payload format</h4>
            <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto text-muted-foreground">{`{
  "id": "uuid",
  "event": "contact.created",
  "timestamp": "2026-03-22T10:00:00Z",
  "tenant_id": "your-org-id",
  "data": { /* event data */ }
}`}</pre>
            <p className="text-xs text-muted-foreground">All requests include <code className="bg-muted px-1 rounded">X-NuCRM-Signature</code> for verification.</p>
          </div>
        </div>
      )}
    </div>
  );
}
