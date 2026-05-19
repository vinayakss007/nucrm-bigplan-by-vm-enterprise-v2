'use client';
import { useState, useEffect } from 'react';
import { Plus, Zap, ToggleLeft, ToggleRight, Play, Trash2, ChevronRight,
  Mail, Bell, Users, Calendar, TrendingUp, Activity, X, Loader2, Edit2, Workflow } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

const TRIGGER_LABELS: Record<string,string> = {
  'contact.created':'Contact Created', 'contact.updated':'Contact Updated',
  'contact.status_changed':'Contact Status Changed',
  'deal.created':'Deal Created', 'deal.stage_changed':'Deal Stage Changed',
  'deal.won':'Deal Won', 'deal.lost':'Deal Lost',
  'task.created':'Task Created', 'task.completed':'Task Completed',
  'task.overdue':'Task Overdue', 'form.submitted':'Form Submitted',
  'tag.added':'Tag Added', 'schedule.daily':'Daily Schedule',
  'schedule.weekly':'Weekly Schedule',
};
const ACTION_LABELS: Record<string,string> = {
  'send_email':'Send Email', 'send_whatsapp':'Send WhatsApp', 'send_sms':'Send SMS',
  'create_task':'Create Task', 'create_deal':'Create Deal', 'update_contact':'Update Contact',
  'assign_contact':'Assign Contact', 'add_tag':'Add Tag', 'remove_tag':'Remove Tag',
  'send_notification':'Send Notification', 'fire_webhook':'Fire Webhook', 'wait':'Wait (delay)',
};
const TRIGGER_ICONS: Record<string,any> = {
  'contact.created': Users, 'deal.created': TrendingUp, 'deal.won': TrendingUp,
  'task.completed': Calendar, 'schedule.daily': Calendar, 'form.submitted': Mail,
};

// Prebuilt toggle workflows (existing system)
const PREBUILT: any[] = [
  { id:'welcome-email', name:'Welcome Email', description:'Send welcome email when contact is created',
    trigger_type:'contact.created', category:'Email', is_prebuilt: true },
  { id:'task-due-reminder', name:'Task Due Reminder', description:'Remind when task is due today (runs daily 9AM)',
    trigger_type:'schedule.daily', category:'Notifications', is_prebuilt: true },
  { id:'deal-stage-change', name:'Deal Stage Alert', description:'Notify team when deal moves to a new stage',
    trigger_type:'deal.stage_changed', category:'Notifications', is_prebuilt: true },
  { id:'lead-assigned', name:'Lead Assignment Notice', description:'Notify rep when a lead is assigned to them',
    trigger_type:'contact.updated', category:'Assignment', is_prebuilt: true },
  { id:'deal-won-celebration', name:'Deal Won Celebration', description:'Notify team when a deal is marked Won',
    trigger_type:'deal.won', category:'Email', is_prebuilt: true },
];

type Tab = 'prebuilt' | 'custom';

export default function AutomationPage() {
  const [tab, setTab]               = useState<Tab>('prebuilt');
  const [prebuilts, setPrebuilts]   = useState<any[]>([]);
  const [customs, setCustoms]       = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting]     = useState<string|null>(null);
  const [toggling, setToggling]     = useState<string|null>(null);
  const [form, setForm] = useState<{
    name:string; description:string; trigger_type:string; is_active:boolean;
    actions: { type:string; config:Record<string,string> }[];
  }>({
    name:'', description:'', trigger_type:'contact.created', is_active:true,
    actions: [{ type:'send_notification', config:{ title:'', body:'', subject:'', tag:'' } }],
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [pb, cu] = await Promise.all([
      fetch('/api/tenant/automation/workflows').then(r => r.json()).catch(() => ({data:[]})),
      fetch('/api/tenant/automations').then(r => r.json()).catch(() => ({data:[]})),
    ]);
    // Merge prebuilts with DB state
    const pbData = PREBUILT.map(p => {
      const db = (pb.data||[]).find((d: any) => d.workflow_id === p.id);
      return { ...p, enabled: db?.enabled ?? false, run_count: db?.run_count ?? 0, last_run_at: db?.last_run_at };
    });
    setPrebuilts(pbData);
    setCustoms(cu.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const togglePrebuilt = async (id: string, current: boolean) => {
    setToggling(id);
    await fetch('/api/tenant/automation/workflows', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ workflow_id: id, enabled: !current }),
    });
    setPrebuilts(p => p.map(w => w.id === id ? { ...w, enabled: !current } : w));
    toast.success(current ? 'Automation paused' : 'Automation enabled');
    setToggling(null);
  };

  const toggleCustom = async (id: string, current: boolean) => {
    setToggling(id);
    await fetch(`/api/tenant/automations/${id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ is_active: !current }),
    });
    setCustoms(c => c.map(a => a.id === id ? { ...a, is_active: !current } : a));
    toast.success(current ? 'Automation paused' : 'Automation enabled');
    setToggling(null);
  };

  const deleteCustom = async (id: string) => {
      setDeleting(id);
    await fetch(`/api/tenant/automations/${id}`, { method:'DELETE' });
    setCustoms(c => c.filter(a => a.id !== id));
    toast.success('Deleted');
    setDeleting(null);
  };

  const createCustom = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/automations', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success('Automation created');
      setShowCreate(false);
      setForm({ name:'', description:'', trigger_type:'contact.created', is_active:true,
        actions:[{ type:'send_notification', config:{ title:'', body:'', subject:'', tag:'' } }] });
      load();
    } else toast.error(d.error);
    setSaving(false);
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
  const totalEnabled = prebuilts.filter(p => p.enabled).length + customs.filter(c => c.is_active).length;

  return (
    <div className="max-w-5xl space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Zap className="w-5 h-5 text-violet-500"/>Automation</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            <span className="text-violet-600 font-semibold">{totalEnabled}</span> active automation{totalEnabled !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/tenant/automation/builder"
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-semibold transition-colors">
            <Workflow className="w-4 h-4"/>Open Builder
          </a>
          <button onClick={() => { setShowCreate(true); setTab('custom'); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
            <Plus className="w-4 h-4"/>New Automation
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit">
        {(['prebuilt','custom'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t === 'prebuilt' ? `Pre-built (${prebuilts.filter(p=>p.enabled).length}/${prebuilts.length})` : `Custom (${customs.length})`}
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">New Custom Automation</h3>
            <button onClick={() => setShowCreate(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <form onSubmit={createCustom} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required className={inp} placeholder="e.g. Follow up after deal won" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Trigger *</label>
                <select value={form.trigger_type} onChange={e => setForm(f => ({...f, trigger_type: e.target.value}))} className={inp}>
                  {Object.entries(TRIGGER_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Action *</label>
                <select value={form.actions[0]?.type} onChange={e => setForm(f => ({...f, actions:[{ type:e.target.value, config:{title:'',body:'',subject:'',tag:''} }]}))} className={inp}>
                  {Object.entries(ACTION_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {form.actions[0]?.type === 'send_notification' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Notification title</label>
                    <input value={form.actions[0]?.config?.['title'] ?? ''} onChange={e => setForm(f => ({...f, actions:[{type: f.actions[0]?.type ?? 'send_notification', config:{ title:e.target.value, body: f.actions[0]?.config?.['body'] ?? '' }}]}))} className={inp} placeholder="Use {{first_name}} for variables" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Notification body</label>
                    <input value={form.actions[0]?.config?.['body'] ?? ''} onChange={e => setForm(f => ({...f, actions:[{type: f.actions[0]?.type ?? 'send_notification', config:{ title: f.actions[0]?.config?.['title'] ?? '', body:e.target.value }}]}))} className={inp} placeholder="Optional message" />
                  </div>
                </>
              )}
              {form.actions[0]?.type === 'send_email' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Email subject</label>
                    <input value={form.actions[0]?.config?.['subject'] ?? ''} onChange={e => setForm(f => ({...f, actions:[{type: f.actions[0]?.type ?? 'send_email', config:{ title: f.actions[0]?.config?.['title'] ?? '', body: f.actions[0]?.config?.['body'] ?? '', subject:e.target.value }}]}))} className={inp} placeholder="Subject line" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Email body</label>
                    <textarea rows={3} value={form.actions[0]?.config?.['body'] ?? ''} onChange={e => setForm(f => ({...f, actions:[{type: f.actions[0]?.type ?? 'send_email', config:{ title: f.actions[0]?.config?.['title'] ?? '', body:e.target.value, subject: f.actions[0]?.config?.['subject'] ?? '' }}]}))} className={inp} placeholder="Use {{first_name}}, {{email}}, {{company}} etc." />
                  </div>
                </>
              )}
              {form.actions[0]?.type === 'add_tag' && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Tag to add</label>
                  <input value={form.actions[0]?.config?.['tag'] ?? ''} onChange={e => setForm(f => ({...f, actions:[{type: f.actions[0]?.type ?? 'add_tag', config:{ title: f.actions[0]?.config?.['title'] ?? '', body: f.actions[0]?.config?.['body'] ?? '', tag:e.target.value }}]}))} className={inp} placeholder="tag-name" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Variables: <code className="bg-muted px-1 rounded">{'{{first_name}}'}</code> <code className="bg-muted px-1 rounded">{'{{email}}'}</code> <code className="bg-muted px-1 rounded">{'{{company}}'}</code> <code className="bg-muted px-1 rounded">{'{{title}}'}</code> <code className="bg-muted px-1 rounded">{'{{stage}}'}</code></p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
              <button type="submit" disabled={saving || !form.name} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pre-built tab */}
      {tab === 'prebuilt' && (
        <div className="space-y-3">
          {loading ? [...Array(5)].map((_,i) => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />) :
          prebuilts.map(w => {
            const Icon = TRIGGER_ICONS[w.trigger_type] ?? Zap;
            return (
              <div key={w.id} className={cn('flex items-center gap-4 p-4 rounded-2xl border transition-all',
                w.enabled ? 'border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/10' : 'border-border bg-card')}>
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                  w.enabled ? 'bg-violet-100 dark:bg-violet-950/40' : 'bg-muted')}>
                  <Icon className={cn('w-5 h-5', w.enabled ? 'text-violet-600' : 'text-muted-foreground')} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{w.name}</p>
                  <p className="text-xs text-muted-foreground">{w.description}</p>
                  {w.run_count > 0 && <p className="text-xs text-violet-600 mt-0.5">Ran {w.run_count} times{w.last_run_at ? ` · last ${formatRelativeTime(w.last_run_at)}` : ''}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                    w.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                    {w.enabled ? 'ON' : 'OFF'}
                  </span>
                  <button onClick={() => togglePrebuilt(w.id, w.enabled)} disabled={toggling === w.id}
                    className="text-muted-foreground hover:text-violet-600 transition-colors">
                    {toggling === w.id ? <Loader2 className="w-6 h-6 animate-spin" /> :
                      w.enabled ? <ToggleRight className="w-7 h-7 text-violet-600" /> : <ToggleLeft className="w-7 h-7" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Custom tab */}
      {tab === 'custom' && (
        <div className="space-y-3">
          {loading ? [...Array(3)].map((_,i) => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />) :
          customs.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-2xl">
              <Zap className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No custom automations yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create automations that run when CRM events happen</p>
              <button onClick={() => setShowCreate(true)} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto hover:bg-violet-700">
                <Plus className="w-4 h-4" />Create First Automation
              </button>
            </div>
          ) : customs.map(a => {
            const Icon = TRIGGER_ICONS[a.trigger_type] ?? Zap;
            return (
              <div key={a.id} className={cn('flex items-center gap-4 p-4 rounded-2xl border transition-all',
                a.is_active ? 'border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/10' : 'border-border bg-card')}>
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                  a.is_active ? 'bg-violet-100 dark:bg-violet-950/40' : 'bg-muted')}>
                  <Icon className={cn('w-5 h-5', a.is_active ? 'text-violet-600' : 'text-muted-foreground')} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{a.name}</p>
                  <p className="text-xs text-muted-foreground">When: <span className="font-medium">{TRIGGER_LABELS[a.trigger_type] ?? a.trigger_type}</span>
                    {Array.isArray(a.actions) && a.actions.length > 0 && <> → {ACTION_LABELS[a.actions[0]?.type] ?? a.actions[0]?.type}</>}
                  </p>
                  {(a.success_count ?? 0) > 0 && <p className="text-xs text-violet-600 mt-0.5">Ran {a.success_count} times{a.last_run_at ? ` · last ${formatRelativeTime(a.last_run_at)}` : ''}</p>}
                  {a.last_error && <p className="text-xs text-red-500 mt-0.5">Last error: {a.last_error}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                    a.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                    {a.is_active ? 'ON' : 'OFF'}
                  </span>
                  <button onClick={() => toggleCustom(a.id, a.is_active)} disabled={toggling === a.id}
                    className="text-muted-foreground hover:text-violet-600 transition-colors">
                    {toggling === a.id ? <Loader2 className="w-6 h-6 animate-spin" /> :
                      a.is_active ? <ToggleRight className="w-7 h-7 text-violet-600" /> : <ToggleLeft className="w-7 h-7" />}
                  </button>
                  <button onClick={() => deleteCustom(a.id)} disabled={deleting === a.id}
                    className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors">
                    {deleting === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
