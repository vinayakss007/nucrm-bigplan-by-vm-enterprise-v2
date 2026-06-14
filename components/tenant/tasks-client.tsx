'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckSquare, Plus, X, User, Clock, CheckCircle, Trash2, Edit } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { Swipeable } from '@/components/ui/swipeable';
import toast from 'react-hot-toast';

const PRIORITY_CFG = {
  high:   { label:'High',   dot:'bg-red-500',   badge:'text-red-600 bg-red-100 dark:bg-red-900/20 dark:text-red-400' },
  medium: { label:'Medium', dot:'bg-amber-500', badge:'text-amber-600 bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400' },
  low:    { label:'Low',    dot:'bg-slate-400', badge:'text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400' },
};

export default function TenantTasksClient({ initialTasks, contacts, _deals, teamMembers, permissions }: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialTasks: any[]; contacts: any[]; deals: any[]; teamMembers: any[];
  permissions: { canCreate:boolean; canEdit:boolean; canDelete:boolean; canAssign:boolean };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  _deals?: any[];
}) {
  const router = useRouter();
  const [tasks, setTasks]       = useState(initialTasks);
  const [filter, setFilter]     = useState<'all'|'open'|'overdue'|'today'|'done'>('open');
  const [showAdd, setShowAdd]   = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm]         = useState({ title:'', priority:'medium', due_date:'', contact_id:'', deal_id:'', assigned_to:'', description:'' });
  const [saving, setSaving]     = useState(false);
  const today = new Date().toISOString().split('T')[0] || '';
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const filtered = tasks.filter(t => {
    if (filter === 'open')   return !t.completed;
    if (filter === 'done')   return t.completed;
    if (filter === 'overdue') return !t.completed && t.due_date && t.due_date < today;
    if (filter === 'today')   return !t.completed && t.due_date === today;
    return true;
  });

  const toggleTask = async (id: string, completed: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed } : t));
    const res = await fetch(`/api/tenant/tasks/${id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ completed }),
    });
    if (!res.ok) { setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !completed } : t)); toast.error('Failed to update'); }
  };

  const deleteTask = async (id: string) => {
    const res = await fetch(`/api/tenant/tasks/${id}`, { method:'DELETE' });
    if (res.ok) { setTasks(prev => prev.filter(t => t.id !== id)); toast.success('Task deleted'); }
    else toast.error('Failed to delete');
  };

  const bulkComplete = async () => {
    const ids = [...selected];
    setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, completed: true } : t));
    await Promise.all(ids.map(id => fetch(`/api/tenant/tasks/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ completed:true }) })));
    setSelected(new Set()); toast.success(`${ids.length} tasks completed`);
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    setTasks(prev => prev.filter(t => !ids.includes(t.id)));
    await Promise.all(ids.map(id => fetch(`/api/tenant/tasks/${id}`, { method:'DELETE' })));
    setSelected(new Set()); toast.success(`${ids.length} tasks deleted`);
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/tasks', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...form, contact_id:form.contact_id||null, deal_id:form.deal_id||null, assigned_to:form.assigned_to||null }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); setSaving(false); return; }
    setTasks(prev => [data.data, ...prev]);
    setForm({ title:'', priority:'medium', due_date:'', contact_id:'', deal_id:'', assigned_to:'', description:'' });
    setShowAdd(false); setSaving(false); toast.success('Task created');
  };

  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const openCount   = tasks.filter(t=>!t.completed).length;
  const overdueCount= tasks.filter(t=>!t.completed&&t.due_date&&t.due_date<today).length;
  const todayCount  = tasks.filter(t=>!t.completed&&t.due_date===today).length;
  const doneCount   = tasks.filter(t=>t.completed).length;

  const TABS = [
    { id:'open',   label:`Open (${openCount})` },
    { id:'overdue',label:`Overdue (${overdueCount})`, urgent:overdueCount>0 },
    { id:'today',  label:`Today (${todayCount})` },
    { id:'done',   label:`Done (${doneCount})` },
    { id:'all',    label:'All' },
  ];

  return (
    <div className="space-y-4 animate-fade-in max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><CheckSquare className="w-5 h-5" />Tasks</h1>
          <p className="text-sm text-muted-foreground">{openCount} open · {overdueCount > 0 && <span className="text-red-500 font-semibold">{overdueCount} overdue</span>}</p>
        </div>
        {permissions.canCreate && (
          <button onClick={() => setShowAdd(s=>!s)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors min-h-[44px]">
            <Plus className="w-4 h-4" />New Task
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap bg-muted/30 rounded-xl p-1 w-fit">
        {TABS.map(t => (
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          <button key={t.id} onClick={() => setFilter(t.id as any)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              filter===t.id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              t.urgent && filter!==t.id && 'text-red-500')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-violet-50 dark:bg-violet-950/20 rounded-xl border border-violet-200 dark:border-violet-800">
          <span className="text-xs font-semibold text-violet-600">{selected.size} selected</span>
          <button onClick={bulkComplete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"><CheckCircle className="w-3.5 h-3.5" />Mark Complete</button>
          <button onClick={bulkDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-500 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"><Trash2 className="w-3.5 h-3.5" />Delete</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <form onSubmit={addTask} className="admin-card p-5 space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">New Task</h3><button type="button" onClick={()=>setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button></div>
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required placeholder="Task title..." className={inp} autoFocus />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div><label className="block text-sm font-bold text-foreground/80 mb-1">Priority</label>
              <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} className={inp}>
                {Object.entries(PRIORITY_CFG).map(([id,{label}])=><option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-bold text-foreground/80 mb-1">Due Date</label><input type="date" value={form.due_date} onChange={e=>setForm(f=>({...f,due_date:e.target.value}))} className={inp} /></div>
            <div><label className="block text-sm font-bold text-foreground/80 mb-1">Contact</label>
              <select value={form.contact_id} onChange={e=>setForm(f=>({...f,contact_id:e.target.value}))} className={inp}>
                <option value="">None</option>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {contacts.map((c:any)=><option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-bold text-foreground/80 mb-1">Assigned To</label>
              <select value={form.assigned_to} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))} className={inp}>
                <option value="">Unassigned</option>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {teamMembers.map((m:any)=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select>
            </div>
          </div>
          <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Description (optional)" rows={2} className={inp+' resize-none'} />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={()=>setShowAdd(false)} className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-accent transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors">{saving?'Creating...':'Create Task'}</button>
          </div>
        </form>
      )}

      {/* Task list */}
      <div className="admin-card overflow-hidden divide-y divide-border">
        {!filtered.length ? (
          <div className="py-12 text-center">
            <CheckSquare className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {filter==='overdue' ? 'No overdue tasks' : filter==='done' ? 'No completed tasks' : filter==='today' ? 'No tasks due today' : 'No tasks'}
            </p>
          </div>
        ) : filtered.map(t => {
          const overdue = !t.completed && t.due_date && t.due_date < today;
          const p = PRIORITY_CFG[t.priority as keyof typeof PRIORITY_CFG] ?? PRIORITY_CFG.medium;
          const isSelected = selected.has(t.id);
          return (
            <Swipeable
              key={t.id}
              rightActions={[
                { label:'Complete', icon:<CheckCircle className="w-5 h-5"/>, color:'text-white', bg:'bg-emerald-500', onClick:()=>toggleTask(t.id,!t.completed) },
                { label:'Edit', icon:<Edit className="w-5 h-5"/>, color:'text-white', bg:'bg-violet-500', onClick:()=>router.push(`/tenant/tasks/${t.id}`) },
                ...(permissions.canDelete ? [{ label:'Delete', icon:<Trash2 className="w-5 h-5"/>, color:'text-white', bg:'bg-red-500', onClick:()=>deleteTask(t.id) }] : []),
              ]}
            >
              <div onClick={() => router.push(`/tenant/tasks/${t.id}`)} className={cn('flex items-start gap-3 px-4 py-3.5 hover:bg-accent/20 transition-colors group cursor-pointer', isSelected && 'bg-violet-50/50 dark:bg-violet-950/10')}>
              {/* Select checkbox */}
              <input type="checkbox" checked={isSelected} onChange={(e)=>{e.stopPropagation(); toggleSelect(t.id)}}
                className="mt-1 accent-violet-600 w-3.5 h-3.5 shrink-0 cursor-pointer" />
              {/* Complete toggle */}
              <button onClick={(e) => {e.stopPropagation(); toggleTask(t.id, !t.completed);}} className="mt-0.5 shrink-0">
                <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                  t.completed ? 'bg-emerald-500 border-emerald-500' : 'border-border hover:border-violet-500')}>
                  {t.completed && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                </div>
              </button>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm font-medium', t.completed && 'line-through text-muted-foreground')}>{t.title}</p>
                {t.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.description}</p>}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded-full', p.badge)}>{p.label}</span>
                  {t.assignee_name && <span className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />{t.assignee_name}</span>}
                  {(t.first_name||t.last_name) && <span className="text-xs text-muted-foreground">{t.first_name} {t.last_name}</span>}
                  {t.deal_title && <span className="text-xs text-muted-foreground">{t.deal_title}</span>}
                  {t.due_date && (
                    <span className={cn('text-xs flex items-center gap-1', overdue ? 'text-red-500 font-semibold' : 'text-muted-foreground')}>
                      <Clock className="w-3 h-3" />{overdue && '⚠ '}{formatDate(t.due_date)}
                    </span>
                  )}
                </div>
              </div>
              {/* Delete */}
              {permissions.canDelete && (
                <button onClick={(e) => {e.stopPropagation(); deleteTask(t.id);}}
                  className="max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 text-muted-foreground transition-all shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              </div>
            </Swipeable>
          );
        })}
      </div>
    </div>
  );
}
