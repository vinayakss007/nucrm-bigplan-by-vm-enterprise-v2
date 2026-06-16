'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Mail, Phone, Globe, Linkedin, Building2, Edit, Save,
  MessageSquare, PhoneCall, AtSign, Calendar, Briefcase, X, Trash2,
  CheckCircle, Plus, ChevronDown, Star,
  Clock, User, History,
  FileText, ShoppingCart, FileSignature, RefreshCw, DollarSign,
} from 'lucide-react';
import { cn, formatCurrency, formatDateTimeShort, formatDate, formatRelativeTime } from '@/lib/utils';
import { getScoreTier, getScoreTierConfig } from '@/lib/scoring';
import { ContactTimeline } from '@/components/tenant/contact-timeline';
import toast from 'react-hot-toast';

// ── Constants ─────────────────────────────────────────────────
const LEAD_STATUSES = [
  { id:'new',         label:'New',         color:'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { id:'contacted',   label:'Contacted',   color:'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  { id:'qualified',   label:'Qualified',   color:'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  { id:'unqualified', label:'Unqualified', color:'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  { id:'converted',   label:'Converted',   color:'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  { id:'lost',        label:'Lost',        color:'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
];

const ACTIVITY_TABS = [
  { id:'note',    label:'Note',    icon:MessageSquare, placeholder:'Add a note...' },
  { id:'call',    label:'Call',    icon:PhoneCall,     placeholder:'Call summary...' },
  { id:'email',   label:'Email',   icon:AtSign,        placeholder:'Email summary...' },
  { id:'meeting', label:'Meeting', icon:Calendar,      placeholder:'Meeting notes...' },
];

const STAGE_COLORS: Record<string,string> = {
  lead:'bg-slate-100 text-slate-600', qualified:'bg-blue-100 text-blue-700',
  proposal:'bg-violet-100 text-violet-700', negotiation:'bg-amber-100 text-amber-700',
  won:'bg-emerald-100 text-emerald-700', lost:'bg-red-100 text-red-600',
};
const ACTIVITY_COLORS: Record<string,string> = {
  note:'text-violet-600 bg-violet-100 dark:bg-violet-900/30',
  call:'text-green-600 bg-green-100 dark:bg-green-900/30',
  email:'text-amber-600 bg-amber-100 dark:bg-amber-900/30',
  meeting:'text-blue-600 bg-blue-100 dark:bg-blue-900/30',
  deal_update:'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
  contact_created:'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30',
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACTIVITY_ICONS: Record<string,any> = {
  note:MessageSquare, call:PhoneCall, email:AtSign, meeting:Calendar,
  task:CheckCircle, deal_update:Briefcase, contact_created:Star,
};

// ── QuickAdd: Task inline ──────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function QuickAddTask({ contactId, _contactName, teamMembers, onAdded }: any) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title:'', priority:'medium', due_date:'', assigned_to:'' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/tasks', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...form, contact_id: contactId }),
    });
    const data = await res.json();
    if (res.ok) { toast.success('Task created'); setOpen(false); setForm({ title:'', priority:'medium', due_date:'', assigned_to:'' }); onAdded(data.data); }
    else toast.error(data.error);
    setSaving(false);
  };
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-violet-600 transition-colors py-1">
        <Plus className="w-3.5 h-3.5" />Add Task
      </button>
      {open && (
        <form onSubmit={save} className="mt-2 p-3 rounded-xl border border-border bg-card space-y-2.5">
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required placeholder="Task title..." className={inp} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} className={inp}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
            <input type="date" value={form.due_date} onChange={e=>setForm(f=>({...f,due_date:e.target.value}))} className={inp} />
          </div>
          <select value={form.assigned_to} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))} className={inp}>
            <option value="">Assign to...</option>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {teamMembers.map((m: any) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">{saving?'Saving...':'Create Task'}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-xs transition-colors">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── QuickAdd: Deal inline ──────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function QuickAddDeal({ contactId, _companies, onAdded }: any) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title:'', value:'', stage:'lead', close_date:'' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/deals', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...form, contact_id: contactId, value: Number(form.value)||0 }),
    });
    const data = await res.json();
    if (res.ok) { toast.success('Deal created'); setOpen(false); setForm({ title:'', value:'', stage:'lead', close_date:'' }); onAdded(data.data); }
    else toast.error(data.error);
    setSaving(false);
  };
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-violet-600 transition-colors py-1">
        <Plus className="w-3.5 h-3.5" />Add Deal
      </button>
      {open && (
        <form onSubmit={save} className="mt-2 p-3 rounded-xl border border-border bg-card space-y-2.5">
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required placeholder="Deal title..." className={inp} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} placeholder="Value ($)" className={inp} />
            <select value={form.stage} onChange={e=>setForm(f=>({...f,stage:e.target.value}))} className={inp}>
              {['lead','qualified','proposal','negotiation','won','lost'].map(s => <option key={s} className="capitalize">{s}</option>)}
            </select>
          </div>
          <input type="date" value={form.close_date} onChange={e=>setForm(f=>({...f,close_date:e.target.value}))} className={inp} placeholder="Close date" />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">{saving?'Saving...':'Create Deal'}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-xs transition-colors">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── QuickAdd: Meeting inline ───────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function QuickAddMeeting({ contactId, onAdded }: any) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title:'', start_time:'', end_time:'', location:'', meeting_url:'' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/meetings', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...form, contact_id: contactId }),
    });
    const data = await res.json();
    if (res.ok) { toast.success('Meeting scheduled'); setOpen(false); onAdded(data.data); }
    else toast.error(data.error);
    setSaving(false);
  };
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-violet-600 transition-colors py-1">
        <Plus className="w-3.5 h-3.5" />Schedule Meeting
      </button>
      {open && (
        <form onSubmit={save} className="mt-2 p-3 rounded-xl border border-border bg-card space-y-2.5">
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required placeholder="Meeting title..." className={inp} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-[10px] text-muted-foreground mb-0.5">Start</label><input type="datetime-local" value={form.start_time} onChange={e=>setForm(f=>({...f,start_time:e.target.value}))} required className={inp} /></div>
            <div><label className="block text-[10px] text-muted-foreground mb-0.5">End</label><input type="datetime-local" value={form.end_time} onChange={e=>setForm(f=>({...f,end_time:e.target.value}))} className={inp} /></div>
          </div>
          <input value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Location (optional)" className={inp} />
          <input value={form.meeting_url} onChange={e=>setForm(f=>({...f,meeting_url:e.target.value}))} placeholder="Meeting URL (Zoom/Meet)" className={inp} />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">{saving?'Saving...':'Schedule'}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-xs transition-colors">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────
export default function ContactDetailClient({
  contact: initialContact, initialActivities, deals: initialDeals,
  tasks: initialTasks, companies, teamMembers, permissions, userId,
  invoices=[], orders=[], contracts=[], subscriptions=[], quotes=[],
}: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any; initialActivities: any[]; deals: any[]; tasks: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  companies: any[]; teamMembers: any[]; permissions: any; userId: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoices?: any[]; orders?: any[]; contracts?: any[]; subscriptions?: any[]; quotes?: any[];
}) {
  const [contact, setContact]       = useState(initialContact);
  const [activities, setActivities] = useState(initialActivities);
  const [deals, setDeals]           = useState(initialDeals);
  const [tasks, setTasks]           = useState(initialTasks);
  const [activeTab, setActiveTab]   = useState('activity'); // 'activity' | 'tasks' | 'deals' | 'history' | 'billing'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [history, setHistory]           = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [contactLeads, setContactLeads]            = useState<any[]>([]);
  const [loadingContactLeads, setLoadingContactLeads] = useState(false);
  const [editing, setEditing]       = useState(false);
  const [editForm, setEditForm]     = useState({ ...initialContact });
  const [noteText, setNoteText]     = useState('');
  const [noteType, setNoteType]     = useState('note');
  const [addingNote, setAddingNote] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [statusReason, setStatusReason]     = useState('');
  const [pendingStatus, setPendingStatus]   = useState<string|null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  const curStatus = LEAD_STATUSES.find(s => s.id === contact.lead_status) ?? LEAD_STATUSES[0]!;
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  // Fetch history when tab changes
  useEffect(() => {
    if (activeTab === 'history' && history.length === 0) {
      const abort = new AbortController();
      setLoadingHistory(true);
      fetch(`/api/tenant/history/contact?entity_id=${contact.id}&limit=50`, { signal: abort.signal })
        .then(res => res.json())
        .then(data => { if (!abort.signal.aborted) setHistory(data.data || []); })
        .catch(err => { if (!abort.signal.aborted) console.error('Failed to load history', err); })
        .finally(() => { if (!abort.signal.aborted) setLoadingHistory(false); });
      return () => abort.abort();
    }
  }, [activeTab, contact.id, history.length]);

  // Fetch the contact's leads (one contact, many leads) on first open
  useEffect(() => {
    if (activeTab === 'leads' && contactLeads.length === 0 && !loadingContactLeads) {
      const abort = new AbortController();
      setLoadingContactLeads(true);
      fetch(`/api/tenant/contacts/${contact.id}/leads`, { signal: abort.signal })
        .then(res => res.json())
        .then(data => { if (!abort.signal.aborted) setContactLeads(data.data || []); })
        .catch(err => { if (!abort.signal.aborted) console.error('Failed to load contact leads', err); })
        .finally(() => { if (!abort.signal.aborted) setLoadingContactLeads(false); });
      return () => abort.abort();
    }
  }, [activeTab, contact.id, contactLeads.length, loadingContactLeads]);

  // ── Add activity / note ──────────────────────────────────────
  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    setAddingNote(true);
    const res = await fetch(`/api/tenant/contacts/${contact.id}/notes`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ type: noteType, description: noteText.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); setAddingNote(false); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setActivities((prev: any) => [{
      ...data.data,
      full_name: 'You',
      created_at: new Date().toISOString(),
    }, ...prev]);
    setNoteText('');
    setAddingNote(false);
    toast.success(`${noteType === 'note' ? 'Note' : noteType.charAt(0).toUpperCase() + noteType.slice(1)} logged`);
  };

  // ── Delete note ──────────────────────────────────────────────
  const deleteNote = async (noteId: string) => {
    await fetch(`/api/tenant/contacts/${contact.id}/notes`, {
      method:'DELETE', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ noteId }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setActivities((prev: any[]) => prev.filter((a: any) => a.id !== noteId));
    toast.success('Note deleted');
  };

  // ── Change lead status ───────────────────────────────────────
  const changeStatus = async (newStatus: string) => {
    const res = await fetch(`/api/tenant/contacts/${contact.id}/status`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ lead_status: newStatus, reason: statusReason }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    setContact((c: any) => ({ ...c, lead_status: newStatus }));
    const desc = `Status changed: ${contact.lead_status} → ${newStatus}${statusReason ? ` — ${statusReason}` : ''}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setActivities((prev: any) => [{
      id: `tmp_${Date.now()}`, type:'note', description: desc,
      created_at: new Date().toISOString(), full_name: 'You',
      metadata: { status_change: true },
    }, ...prev]);
    setShowStatusMenu(false); setPendingStatus(null); setStatusReason('');
    toast.success('Status updated');
  };

  // ── Save edit ────────────────────────────────────────────────
  const saveEdit = async () => {
    setSavingEdit(true);
    const tagsArray = typeof editForm.tags === 'string'
      ? editForm.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : editForm.tags;

    const res = await fetch(`/api/tenant/contacts/${contact.id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...editForm, tags: tagsArray }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); setSavingEdit(false); return; }
    setContact(data.data);
    setEditing(false); setSavingEdit(false);
    toast.success('Contact updated');
  };

  // ── Toggle task complete ─────────────────────────────────────
  const toggleTask = async (taskId: string, completed: boolean) => {
    const res = await fetch(`/api/tenant/tasks/${taskId}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ completed }),
    });
    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTasks((prev: any[]) => prev.map((t: any) => t.id === taskId ? { ...t, completed } : t));
    }
  };

  return (
    <div className="max-w-7xl space-y-0 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center gap-4 mb-5">
        <button onClick={() => window.history.back()} className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-lg font-bold shrink-0">
          {contact.first_name?.charAt(0)?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{contact.first_name} {contact.last_name}</h1>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {contact.company_name && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Building2 className="w-3 h-3" />{contact.company_name}</span>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-violet-600 transition-colors"><Mail className="w-3 h-3" />{contact.email}</a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-violet-600 transition-colors"><Phone className="w-3 h-3" />{contact.phone}</a>
            )}
          </div>
        </div>
        {/* Status pill */}
        <div className="relative shrink-0">
          <button onClick={() => setShowStatusMenu(s => !s)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border-2 border-transparent transition-all', curStatus.color)}>
            {curStatus.label}<ChevronDown className="w-3 h-3" />
          </button>
          {showStatusMenu && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-card border border-border rounded-xl shadow-xl w-56 overflow-hidden">
              <div className="p-2 space-y-0.5">
                {LEAD_STATUSES.map(s => (
                  <button key={s.id} onClick={() => { setPendingStatus(s.id); setShowStatusMenu(false); }}
                    disabled={contact.lead_status === s.id}
                    className={cn('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-default')}>
                    <span className={cn('px-2 py-0.5 rounded-full', s.color)}>{s.label}</span>
                    {contact.lead_status === s.id && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {permissions.canEdit && (
          <button onClick={() => { 
            setEditing(e => !e); 
            setEditForm({ 
              ...contact,
              tags: Array.isArray(contact.tags) ? contact.tags.join(', ') : ''
            }); 
          }}
            className={cn('p-2 rounded-lg transition-colors shrink-0', editing ? 'bg-violet-600 text-white' : 'hover:bg-accent text-muted-foreground')}>
            <Edit className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Status change confirm ── */}
      {pendingStatus && (
        <div className="admin-card p-4 border-violet-500/30 bg-violet-50/50 dark:bg-violet-950/20 mb-4">
          <p className="text-sm font-medium mb-2">
            Change status to{' '}
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', LEAD_STATUSES.find(s=>s.id===pendingStatus)?.color)}>
              {LEAD_STATUSES.find(s=>s.id===pendingStatus)?.label}
            </span>?
          </p>
          <input value={statusReason} onChange={e => setStatusReason(e.target.value)}
            placeholder="Reason (optional — will be logged in activity)" className={inp + ' mb-3'} />
          <div className="flex gap-2">
            <button onClick={() => changeStatus(pendingStatus!)} className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition-colors">Confirm</button>
            <button onClick={() => { setPendingStatus(null); setStatusReason(''); }} className="px-4 py-1.5 rounded-lg border border-border text-xs hover:bg-accent transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Main 3-column layout ── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">

        {/* ── Left: contact info ── */}
        <div className="xl:col-span-1 space-y-4">
          {editing ? (
            <div className="admin-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Edit Contact</p>
                <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              {[
                ['first_name','First Name *'], ['last_name','Last Name'],
                ['email','Email'], ['phone','Phone'],
                ['city','City'], ['country','Country'],
                ['website','Website'], ['linkedin_url','LinkedIn'],
                ['lead_source','Lead Source'],
              ].map(([f, lbl]) => (
                <div key={f}>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">{lbl}</label>
                  <input value={editForm[f as string]||''} onChange={e => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setEditForm((prev: any) => ({ ...prev, [f as string]: e.target.value }))}} className={inp} />
                </div>
              ))}
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Tags (comma separated)</label>
                <input value={editForm.tags||''} onChange={e => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setEditForm((prev: any) => ({ ...prev, tags: e.target.value }))}} className={inp} />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Company</label>
                <select value={editForm.company_id||''} onChange={e => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setEditForm((p: any) => ({...p, company_id: e.target.value||null}))}} className={inp}>
                  <option value="">No company</option>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Assigned To</label>
                <select value={editForm.assigned_to||''} onChange={e => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setEditForm((p: any) => ({...p, assigned_to: e.target.value||null}))}} className={inp}>
                  <option value="">Unassigned</option>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {teamMembers.map((m: any) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Notes</label>
                <textarea value={editForm.notes||''} onChange={e => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setEditForm((p: any) => ({...p, notes: e.target.value}))}} rows={3} className={inp+' resize-none'} />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={saveEdit} disabled={savingEdit} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors">
                  <Save className="w-3.5 h-3.5" />{savingEdit ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-xl border border-border text-xs hover:bg-accent transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="admin-card p-4 space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Contact Info</p>
              {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-violet-600 transition-colors"><Mail className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />{contact.email}</a>}
              {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-violet-600 transition-colors"><Phone className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />{contact.phone}</a>}
              {contact.website && <a href={contact.website} target="_blank" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-violet-600 transition-colors"><Globe className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />{contact.website.replace(/https?:\/\//,'')}</a>}
              {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-violet-600 transition-colors"><Linkedin className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />LinkedIn</a>}
              <div className="pt-2 border-t border-border space-y-1.5">
                {contact.lead_source && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Source</span><span className="font-medium capitalize">{contact.lead_source.replace(/_/g,' ')}</span></div>}
                {contact.assigned_name && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Owner</span><span className="font-medium">{contact.assigned_name}</span></div>}
                {(contact.city || contact.country) && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Location</span><span className="font-medium">{[contact.city,contact.country].filter(Boolean).join(', ')}</span></div>}
                {contact.score > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Score</span><span className="font-bold text-violet-600">{contact.score}</span></div>}
                {contact.score > 0 && (() => {
                  const tier = getScoreTier(contact.score);
                  const cfg = getScoreTierConfig(tier);
                  return (
                    <div className={cn('mt-2 p-2 rounded-lg', cfg.bg)}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn('text-[10px] font-bold uppercase', cfg.color)}>{cfg.label}</span>
                        <span className={cn('text-xs font-bold', cfg.color)}>{contact.score}/100</span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', cfg.bar)} style={{ width: `${Math.min(100, contact.score)}%` }} />
                      </div>
                    </div>
                  );
                })()}
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Created</span><span className="font-medium">{formatDate(contact.created_at)}</span></div>
              </div>
              {(contact.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 pt-2 border-t border-border">
                  {(contact.tags).map((t:string) => (
                    <span key={t} className="text-[10px] bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              )}
              {contact.notes && <p className="text-xs text-muted-foreground pt-2 border-t border-border whitespace-pre-wrap">{contact.notes}</p>}
            </div>
          )}

          {/* Quick actions */}
          <div className="admin-card p-4 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Add</p>
            <QuickAddTask contactId={contact.id} contactName={`${contact.first_name} ${contact.last_name}`} teamMembers={teamMembers} onAdded={(t: Record<string, any>) => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setTasks((prev: any) => [t, ...prev])}} />
            <QuickAddDeal contactId={contact.id} companies={companies} onAdded={(d: Record<string, any>) => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setDeals((prev: any) => [d, ...prev])}} />
            <QuickAddMeeting contactId={contact.id} onAdded={(m: Record<string, any>) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              setActivities((prev: any) => [{ id:`tmp_${Date.now()}`, type:'meeting', description:`Meeting scheduled: ${m.title}`, created_at:new Date().toISOString(), full_name:'You' }, ...prev]);
            }} />
          </div>
        </div>

        {/* ── Right: tabs (activity / tasks / deals / history) ── */}
        <div className="xl:col-span-3 space-y-4">
          {/* Tab bar */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-1 w-fit">
            {[
              { id:'activity', label:`Activity (${activities.length})` },
              { id:'leads',    label:`Leads${contactLeads.length ? ` (${contactLeads.length})` : ''}` },
              { id:'tasks',    label:`Tasks (${tasks.filter(t=>!t.completed).length} open)` },
              { id:'deals',    label:`Deals (${deals.length})` },
              { id:'billing',  label:`Billing (${invoices.length + orders.length + contracts.length + subscriptions.length + quotes.length})`, icon: DollarSign },
              { id:'history', label:'History', icon: History },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={cn('px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5',
                  activeTab === tab.id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {tab.icon && <tab.icon className="w-3.5 h-3.5" />}
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── ACTIVITY TAB ── */}
          {activeTab === 'activity' && (
            <div className="space-y-3">
              {/* Note composer */}
              <div className="admin-card p-4">
                <div className="flex rounded-xl border border-border overflow-hidden mb-3">
                  {ACTIVITY_TABS.map(t => (
                    <button key={t.id} onClick={() => setNoteType(t.id)}
                      className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium flex-1 justify-center transition-colors',
                        noteType === t.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                      <t.icon className="w-3.5 h-3.5" />{t.label}
                    </button>
                  ))}
                </div>
                <form onSubmit={addNote}>
                  <textarea
                    ref={textareaRef}
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder={ACTIVITY_TABS.find(t=>t.id===noteType)?.placeholder}
                    rows={3}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onKeyDown={e => { if (e.key==='Enter' && (e.metaKey||e.ctrlKey) && noteText.trim()) { e.preventDefault(); addNote(e as any); }}}
                  />
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-muted-foreground">⌘+Enter to save · Will be timestamped automatically</p>
                    <button type="submit" disabled={!noteText.trim() || addingNote}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-40 transition-colors">
                      <Plus className="w-3.5 h-3.5" />{addingNote ? 'Saving...' : 'Log'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Timeline */}
              <div className="admin-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-sm font-semibold">Manual log</p>
                  <p className="text-xs text-muted-foreground">{activities.length} entries · notes, calls, emails, meetings you log</p>
                </div>
                {!activities.length ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No activity yet — log a note, call, email or meeting above
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {activities.map((a: any, i: number) => {
                      const Icon = ACTIVITY_ICONS[a.type] ?? MessageSquare;
                      const colorCls = ACTIVITY_COLORS[a.type] ?? 'text-gray-600 bg-gray-100';
                      const isStatusChange = a.metadata?.status_change;
                      const isOwn = a.user_id === userId || a.full_name === 'You';
                      return (
                        <div key={a.id ?? i} className="flex gap-3.5 px-5 py-4 group hover:bg-accent/20 transition-colors">
                          <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5', colorCls)}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-relaxed">{a.description}</p>
                            {/* Timestamp with full date/time */}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {a.full_name && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <User className="w-3 h-3" />{a.full_name}
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-xs text-muted-foreground" title={new Date(a.created_at).toLocaleString()}>
                                <Clock className="w-3 h-3" />
                                <span className="font-medium text-foreground/70">{formatDateTimeShort(a.created_at)}</span>
                                <span className="text-muted-foreground/50">·</span>
                                <span>{formatRelativeTime(a.created_at)}</span>
                              </span>
                              {isStatusChange && (
                                <span className="text-[10px] bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-semibold">
                                  Status Change
                                </span>
                              )}
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold capitalize', colorCls)}>
                                {a.type?.replace('_',' ')}
                              </span>
                            </div>
                          </div>
                          {/* Delete button — only own notes */}
                          {isOwn && !['contact_created'].includes(a.type) && !a.id?.startsWith('tmp_') && (
                            <button onClick={() => deleteNote(a.id)}
                              className="max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all shrink-0 mt-1">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* System events timeline — emails opened/clicked, calls, meetings, deals, lifecycle changes, automations, forms, webhooks */}
              <div className="admin-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-sm font-semibold">System events</p>
                  <p className="text-xs text-muted-foreground">Auto-tracked: email opens/clicks, calls, meetings, deals, lifecycle changes, forms, automations</p>
                </div>
                <div className="p-5">
                  <ContactTimeline contactId={contact.id} />
                </div>
              </div>
            </div>
          )}

          {/* ── TASKS TAB ── */}
          {activeTab === 'tasks' && (
            <div className="admin-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <p className="text-sm font-semibold">Tasks</p>
                <QuickAddTask contactId={contact.id} contactName={`${contact.first_name} ${contact.last_name}`} teamMembers={teamMembers} onAdded={(t: Record<string, any>) => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setTasks((prev: any) => [t, ...prev])}} />
              </div>
              {!tasks.length ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">No tasks yet — create one above</div>
              ) : (
                <div className="divide-y divide-border">
                  {[...tasks].sort((a: any, b: any) => {
                    if (a.completed && !b.completed) return 1;
                    if (!a.completed && b.completed) return -1;
                    if (!a.due_date && !b.due_date) return 0;
                    if (!a.due_date) return 1;
                    if (!b.due_date) return -1;
                    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
                  }).map((t: any) => {
                    const today = new Date().toISOString().split('T')[0] || '';
                    const overdue = !t.completed && t.due_date && t.due_date < today;
                    return (
                      <div key={t.id} className={cn('flex items-start gap-3 px-5 py-3.5 hover:bg-accent/20 transition-colors', t.completed && 'opacity-50')}>
                        <button onClick={() => toggleTask(t.id, !t.completed)} className="mt-0.5 shrink-0">
                          <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
                            t.completed ? 'bg-emerald-500 border-emerald-500' : 'border-border hover:border-violet-500')}>
                            {t.completed && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                          </div>
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={cn('text-sm font-medium', t.completed && 'line-through text-muted-foreground')}>{t.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize',
                              t.priority==='high' ? 'text-red-600 bg-red-100 dark:bg-red-900/20' :
                              t.priority==='medium' ? 'text-amber-600 bg-amber-100 dark:bg-amber-900/20' :
                              'text-slate-500 bg-slate-100 dark:bg-slate-800')}>
                              {t.priority}
                            </span>
                            {t.assignee_name && <span className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />{t.assignee_name}</span>}
                            {t.due_date && (
                              <span className={cn('text-xs flex items-center gap-1', overdue ? 'text-red-500 font-semibold' : 'text-muted-foreground')}>
                                <Clock className="w-3 h-3" />{formatDate(t.due_date)}{overdue && ' — Overdue'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── DEALS TAB ── */}
          {activeTab === 'deals' && (
            <div className="admin-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <p className="text-sm font-semibold">Deals</p>
                <QuickAddDeal contactId={contact.id} companies={companies} onAdded={(d: Record<string, any>) => {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ setDeals((prev: any) => [d, ...prev])}} />
              </div>
              {!deals.length ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">No deals yet — create one above</div>
              ) : (
                <div className="divide-y divide-border">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {deals.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-4 px-5 py-4 hover:bg-accent/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{d.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize', STAGE_COLORS[d.stage]??STAGE_COLORS["lead"])}>{d.stage}</span>
                          {d.close_date && <span className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" />Close: {formatDate(d.close_date)}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-bold text-violet-600">{formatCurrency(Number(d.value))}</p>
                        <p className="text-xs text-muted-foreground">{formatRelativeTime(d.created_at)}</p>
                      </div>
                    </div>
                  ))}
                  <div className="px-5 py-3 bg-muted/20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Total pipeline</span>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <span className="text-sm font-bold">{formatCurrency(deals.filter((d: any)=>!['lost'].includes(d.stage)).reduce((s: any, d: any)=>s+Number(d.value),0))}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── LEADS TAB (every lead this contact has been on — past + present) ── */}
          {activeTab === 'leads' && (
            <div className="admin-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <p className="text-sm font-semibold">Leads</p>
                <span className="text-xs text-muted-foreground">
                  Every sales conversation with this person
                </span>
              </div>
              {loadingContactLeads ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">Loading…</div>
              ) : !contactLeads.length ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No leads linked to this contact yet
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {contactLeads.map((l: any) => {
                    const status = LEAD_STATUSES.find(s => s.id === l.lead_status) ?? LEAD_STATUSES[0]!;
                    const offerLabel = l.offer_total > 0
                      ? `${l.offer_currency} ${Number(l.offer_total).toLocaleString()}`
                      : null;
                    return (
                      <div
                        key={l.id}
                        onClick={() => router.push(`/tenant/leads/${l.id}`)}
                        className="px-5 py-4 hover:bg-accent/20 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground">
                                {l.lead_oid ?? l.id.slice(0, 8)}
                              </span>
                              <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold', status.color)}>
                                {status.label}
                              </span>
                              {l.product_id && (
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 bg-violet-50 dark:bg-violet-900/20 px-2 py-0.5 rounded-full">
                                  {l.product_id}
                                </span>
                              )}
                              {l.lifecycle_stage && (
                                <span className="text-[10px] capitalize text-muted-foreground">
                                  · {l.lifecycle_stage.replace(/_/g, ' ')}
                                </span>
                              )}
                            </div>
                            {(l.need_description || l.timeline || l.budget) && (
                              <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                                {[
                                  l.budget && `${l.budget_currency || 'USD'} ${Number(l.budget).toLocaleString()} budget`,
                                  l.timeline && `${l.timeline}`,
                                  l.need_description,
                                ].filter(Boolean).join(' · ')}
                              </p>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                              {l.assigned_name && (
                                <span className="flex items-center gap-1">
                                  <User className="w-3 h-3" />
                                  {l.assigned_name}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatRelativeTime(l.last_activity_at || l.updated_at || l.created_at)}
                              </span>
                              {l.score > 0 && (
                                <span className="flex items-center gap-1">
                                  <Star className="w-3 h-3" />
                                  {l.score}/100
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {offerLabel && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Open offers</p>
                                <p className="text-sm font-bold text-violet-600">{offerLabel}</p>
                                <p className="text-[10px] text-muted-foreground">{l.offer_count} item{l.offer_count === 1 ? '' : 's'}</p>
                              </div>
                            )}
                            {!offerLabel && l.value && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Estimated value</p>
                                <p className="text-sm font-bold text-violet-600">
                                  {l.budget_currency || 'USD'} {Number(l.value).toLocaleString()}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY TAB ── */}
          {activeTab === 'history' && (
            <div className="admin-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <p className="text-sm font-semibold">Edit History</p>
                <span className="text-xs text-muted-foreground">{history.length} changes</span>
              </div>
              {loadingHistory ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">Loading...</div>
              ) : !history.length ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">No edit history yet</div>
              ) : (
                <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {history.map((h: any) => (
                    <div key={h.id} className="px-5 py-4 hover:bg-accent/10 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded">
                              {h.fieldLabel || h.fieldName}
                            </span>
                          </div>
                          <div className="mt-2 text-sm">
                            <span className="text-muted-foreground line-through">{h.oldValue || '(empty)'}</span>
                            <span className="mx-2">→</span>
                            <span className="font-medium">{h.newValue || '(empty)'}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-muted-foreground">{h.userName || h.userEmail || 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground">{formatRelativeTime(h.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── BILLING TAB ── */}
          {activeTab === 'billing' && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="admin-card p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Invoices</p>
                  <p className="text-xl font-bold text-violet-600">{invoices.length}</p>
                </div>
                <div className="admin-card p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Orders</p>
                  <p className="text-xl font-bold text-blue-600">{orders.length}</p>
                </div>
                <div className="admin-card p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Contracts</p>
                  <p className="text-xl font-bold text-green-600">{contracts.length}</p>
                </div>
                <div className="admin-card p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Subs</p>
                  <p className="text-xl font-bold text-amber-600">{subscriptions.length}</p>
                </div>
                <div className="admin-card p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Quotes</p>
                  <p className="text-xl font-bold text-emerald-600">{quotes.length}</p>
                </div>
              </div>

              {/* Unified billing timeline */}
              <div className="admin-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-sm font-semibold">Billing History</p>
                  <div className="flex gap-2">
                    <button onClick={() => router.push(`/tenant/invoices?contactId=${contact.id}`)} className="text-xs text-violet-600 hover:underline flex items-center gap-1"><FileText className="w-3 h-3" />Invoices</button>
                    <button onClick={() => router.push(`/tenant/orders?contactId=${contact.id}`)} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><ShoppingCart className="w-3 h-3" />Orders</button>
                    <button onClick={() => router.push(`/tenant/contracts?contactId=${contact.id}`)} className="text-xs text-green-600 hover:underline flex items-center gap-1"><FileSignature className="w-3 h-3" />Contracts</button>
                    <button onClick={() => router.push(`/tenant/quotes?contactId=${contact.id}`)} className="text-xs text-emerald-600 hover:underline flex items-center gap-1"><FileText className="w-3 h-3" />Quotes</button>
                  </div>
                </div>

                {/* Build unified timeline */}
                {(() => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                  type BillingItem = { type: string; item: any; date: Date; label: string; amount: number; status: string; number: string; };
                  const items: BillingItem[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
                  invoices.forEach((i: any) => items.push({ type: 'invoice', item: i, date: new Date(i.createdAt), label: i.title || i.invoiceNumber, amount: parseFloat(i.totalAmount || 0), status: i.status, number: i.invoiceNumber || '' }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                  orders.forEach((o: any) => items.push({ type: 'order', item: o, date: new Date(o.createdAt), label: o.title || o.orderNumber, amount: parseFloat(o.totalAmount || 0), status: o.status, number: o.orderNumber || '' }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                  contracts.forEach((c: any) => items.push({ type: 'contract', item: c, date: new Date(c.createdAt), label: c.title, amount: parseFloat(c.totalValue || 0), status: c.status, number: c.contractNumber || '' }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                  subscriptions.forEach((s: any) => items.push({ type: 'subscription', item: s, date: new Date(s.createdAt), label: s.name, amount: parseFloat(s.amount || 0), status: s.status, number: '' }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                  quotes.forEach((q: any) => items.push({ type: 'quote', item: q, date: new Date(q.createdAt), label: q.title, amount: parseFloat(q.totalAmount || 0), status: q.status, number: q.quoteNumber || '' }));

                  items.sort((a, b) => b.date.getTime() - a.date.getTime());

                  if (!items.length) {
                    return <div className="px-5 py-10 text-center text-sm text-muted-foreground">No billing records — create an invoice, order, contract, subscription or quote</div>;
                  }

                  return (
                    <div className="divide-y divide-border">
                      {items.map((entry, idx) => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const typeIcons: Record<string, any> = {
                          invoice: FileText, order: ShoppingCart, contract: FileSignature,
                          subscription: RefreshCw, quote: FileText,
                        };
                        const typeColors: Record<string, string> = {
                          invoice: 'bg-violet-100 text-violet-600',
                          order: 'bg-blue-100 text-blue-600',
                          contract: 'bg-green-100 text-green-600',
                          subscription: 'bg-amber-100 text-amber-600',
                          quote: 'bg-emerald-100 text-emerald-600',
                        };
                        const Icon = typeIcons[entry.type] || FileText;
                        const _statusBadgeColors: Record<string, string> = {
                          draft: 'bg-slate-100 text-slate-600', sent: 'bg-blue-100 text-blue-700',
                          paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700',
                          active: 'bg-green-100 text-green-700', accepted: 'bg-green-100 text-green-700',
                          cancelled: 'bg-gray-100 text-gray-600', confirmed: 'bg-blue-100 text-blue-700',
                          processing: 'bg-indigo-100 text-indigo-700', shipped: 'bg-violet-100 text-violet-700',
                          delivered: 'bg-green-100 text-green-700', expired: 'bg-amber-100 text-amber-700',
                          declined: 'bg-red-100 text-red-700',
                        };

                        return (
                          <div key={idx} className="flex items-start gap-3 px-5 py-4 hover:bg-accent/20 transition-colors group">
                            <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0', typeColors[entry.type])}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{entry.type}</span>
                                {entry.number && <span className="text-xs font-mono text-muted-foreground">{entry.number}</span>}
                                <span className="px-2 py-0.5 text-[10px] rounded-full font-semibold capitalize" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>{entry.status}</span>
                              </div>
                              <p className="text-sm font-medium mt-0.5">{entry.label}</p>
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(entry.date)}</span>
                                <span className="text-sm font-bold text-violet-600">{formatCurrency(entry.amount)}</span>
                              </div>
                            </div>
                            <div className="flex gap-1 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={() => router.push(`/tenant/${entry.type}s/${entry.item.id}`)}
                                className="p-1.5 hover:bg-accent rounded" title="View"
                              ><FileText className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
