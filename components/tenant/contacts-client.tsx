'use client';
import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Grid, List, Trash2, ChevronRight, Download, Upload,
  Users, AlertCircle, X, Mail, Phone, Building2, User, Tag, Star, Zap, Activity,
  CheckCircle, XCircle, Archive, Globe, Edit, UserPlus,
  CircleDot,
} from 'lucide-react';
import { cn, formatDate, getInitials, toSnakeCase } from '@/lib/utils';
import { getScoreTier, getScoreTierConfig } from '@/lib/scoring';
import ImportModal from './import-modal';
import Pagination from './pagination';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { showUndoToast } from '@/lib/undo';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import { Swipeable } from '@/components/ui/swipeable';


import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

const STATUS_CONFIG: Record<string,{label:string;color:string;dot:string;icon:React.ComponentType<{className?:string}>}> = {
  new:         { label:'New',          color:'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',         dot:'bg-slate-400',   icon:Star },
  contacted:   { label:'Contacted',    color:'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',              dot:'bg-sky-500',     icon:Phone },
  qualified:   { label:'Qualified',    color:'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',  dot:'bg-violet-500',  icon:CheckCircle },
  unqualified: { label:'Disqualified', color:'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',              dot:'bg-red-500',     icon:XCircle },
  converted:   { label:'Converted',    color:'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',dot:'bg-emerald-500',icon:Zap },
  lost:        { label:'Lost',         color:'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',             dot:'bg-gray-400',    icon:Archive },
};

const LIFECYCLE_COLORS: Record<string,string> = {
  visitor:'bg-slate-100 text-slate-600', lead:'bg-sky-100 text-sky-700',
  marketing_qualified_lead:'bg-violet-100 text-violet-700', sales_qualified_lead:'bg-indigo-100 text-indigo-700',
  opportunity:'bg-amber-100 text-amber-700', customer:'bg-emerald-100 text-emerald-700',
  evangelist:'bg-pink-100 text-pink-700',
};

const SOURCE_LABELS: Record<string,string> = {
  website:'Website', referral:'Referral', cold_outreach:'Cold Outreach',
  social_media:'Social', event:'Event', inbound:'Inbound', advertisement:'Ad', other:'Other',
};

interface CompanyOpt { id: string; name: string }
interface TeamMemberOpt { user_id: string; full_name: string }

interface Props {
  initialContacts: Record<string, unknown>[];
  companies: CompanyOpt[];
  teamMembers: TeamMemberOpt[];
  permissions: { canCreate:boolean; canEdit:boolean; canDelete:boolean; canViewAll:boolean; canImport?:boolean; canExport?:boolean; canAssign?:boolean };
  totalCount?: number;
  tenantId: string;
  userId: string;
  initialOffset?: number;
  initialQ?: string;
  initialStatus?: string;
  _tenantId?: string;
  _userId?: string;
}

function AddContactModal({ companies, teamMembers, onClose, onSuccess }: { companies: CompanyOpt[]; teamMembers: TeamMemberOpt[]; onClose: () => void; onSuccess: () => void }) {
  const [form,setForm] = useState({first_name:'',last_name:'',email:'',phone:'',company_id:'',lead_status:'new',lead_source:'',assigned_to:'',title:'',tags:''});
  const [saving,setSaving] = useState(false);
  const [dupWarning,setDupWarning] = useState<{id:string}|null>(null);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setDupWarning(null);
    const tagsArray = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const res = await fetch('/api/tenant/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ ...form, tags: tagsArray })});
    const data = await res.json();
    if (!res.ok) {
      if (data.is_duplicate) { setDupWarning({id:data.duplicate_id}); setSaving(false); return; }
      toast.error(data.error||'Failed'); setSaving(false); return;
    }
    toast.success('Contact added'); onSuccess(); onClose();
    setSaving(false);
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-shadow";
  const lbl = "block text-sm font-bold text-foreground/80 mb-1.5 uppercase tracking-wide";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Users className="w-3.5 h-3.5 text-emerald-600"/>
            </div>
            New Contact
          </DialogTitle>
        </DialogHeader>

        {dupWarning && (
          <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"/>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Duplicate email detected</p>
              <p className="text-xs text-amber-600/80 mt-0.5">A contact with this email already exists.</p>
            </div>
            <Link href={`/tenant/contacts/${dupWarning.id}`} className="text-xs font-semibold text-amber-600 hover:underline whitespace-nowrap">View existing →</Link>
          </div>
        )}

        <form onSubmit={handle} className="mt-1 space-y-5">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-widest text-foreground/70 mb-3 flex items-center gap-2"><User className="w-3.5 h-3.5"/>Identity</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>First Name *</label><input required className={inp} value={form.first_name} onChange={e=>setForm(p=>({...p,first_name:e.target.value}))}/></div>
              <div><label className={lbl}>Last Name</label><input className={inp} value={form.last_name} onChange={e=>setForm(p=>({...p,last_name:e.target.value}))}/></div>
              <div><label className={lbl}>Email</label><input type="email" className={inp} value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))}/></div>
              <div><label className={lbl}>Phone</label><input type="tel" className={inp} value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))}/></div>
              <div><label className={lbl}>Job Title</label><input className={inp} placeholder="e.g. Marketing Director" value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/></div>
              <div><label className={lbl}>Company</label>
                <select className={inp} value={form.company_id} onChange={e=>setForm(p=>({...p,company_id:e.target.value}))}>
                  <option value="">No company</option>
                  {companies.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="border-t border-border/50 pt-4">
            <p className="text-xs font-extrabold uppercase tracking-widest text-foreground/70 mb-3 flex items-center gap-2"><Tag className="w-3.5 h-3.5"/>Classification</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Status</label>
                <select className={inp} value={form.lead_status} onChange={e=>setForm(p=>({...p,lead_status:e.target.value}))}>
                  {Object.entries(STATUS_CONFIG).map(([v,c])=><option key={v} value={v}>{c.label}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Lead Source</label>
                <select className={inp} value={form.lead_source} onChange={e=>setForm(p=>({...p,lead_source:e.target.value}))}>
                  <option value="">Unknown</option>
                  {Object.entries(SOURCE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={lbl}>Tags (comma separated)</label>
                <input className={inp} placeholder="e.g. vip, conference-2024" value={form.tags} onChange={e=>setForm(p=>({...p,tags:e.target.value}))}/>
              </div>
            </div>
          </div>
          {teamMembers.length>0&&(
            <div className="border-t border-border/50 pt-4">
              <p className="text-xs font-extrabold uppercase tracking-widest text-foreground/70 mb-3 flex items-center gap-2"><Users className="w-3.5 h-3.5"/>Assignment</p>
              <select className={inp} value={form.assigned_to} onChange={e=>setForm(p=>({...p,assigned_to:e.target.value}))}>
                <option value="">Unassigned</option>
                {teamMembers.map((m)=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1 bg-violet-600 hover:bg-violet-700 text-white" disabled={saving}>{saving?'Adding...':'Add Contact'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TenantContactsClient({ initialContacts, companies, teamMembers, permissions, _tenantId, _userId, totalCount, initialOffset, initialQ, initialStatus }: Props) {
  const normalize = (data: Record<string, unknown>[]) => (data || []).map((c) => toSnakeCase(c));
  const [contacts, setContacts] = useState(normalize(initialContacts));
  const [total, setTotal]       = useState(totalCount ?? initialContacts.length);
  const [offset, setOffset]     = useState(initialOffset ?? 0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPrompt, setBulkPrompt] = useState<
    | { kind: 'tag' | 'untag'; title: string; placeholder: string }
    | { kind: 'assign'; title: string }
    | { kind: 'status'; title: string }
    | null
  >(null);
  const [bulkInput, setBulkInput] = useState('');
  const limit                   = 50;
  const [view, setView]         = useState<'list'|'grid'>('list');
  const [search, setSearch]     = useState(initialQ || '');
  const [statusFilter, setStatusFilter] = useState(initialStatus || 'all');
  const [showAdd, setShowAdd]   = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [_exporting, setExporting] = useState(false);
  const router = useRouter();

  const load = useCallback(async (newOffset=0, q=search, status=statusFilter) => {
    setLoading(true);
    const params = new URLSearchParams({ offset:String(newOffset) });
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    router.push(`/tenant/contacts?${params.toString()}`, { scroll: false });
    const res = await fetch('/api/tenant/contacts?'+params.toString());
    const data = await res.json();
    setContacts(normalize(data.data));
    setTotal(data.total ?? 0);
    setOffset(newOffset);
    setLoading(false);
  }, [search, statusFilter, router]);

  const handleSearch = (q:string) => { setSearch(q); load(0, q, statusFilter); };
  const handleStatus = (s:string) => { setStatusFilter(s); load(0, search, s); };

  const deleteContact = async (id:string, name:string) => {
    await confirmThen(`Delete ${name}?`, async () => {
      const contact = contacts.find(c => c['id'] === id);
      const res = await fetch(`/api/tenant/contacts/${id}`, { method:'DELETE' });
      if (res.ok) {
        showUndoToast(`Deleted ${name}`, async () => {
          if (contact) {
            await fetch('/api/tenant/contacts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(contact),
            });
          }
        });
        load(offset);
      }
      else toast.error('Failed to delete');
    });
  };

  const _exportCSV = async () => {
    setExporting(true);
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    const res = await fetch('/api/tenant/contacts/export?'+q);
    if (!res.ok) { toast.error('Nothing to export'); setExporting(false); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url); toast.success('Exported contacts'); setExporting(false);
  };

  // ── Selection helpers ────────────────────────────────────────────────
  const toggleOne = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allSelectedOnPage = useMemo(
    () => contacts.length > 0 && contacts.every(c => selectedIds.has(c['id'])),
    [contacts, selectedIds],
  );
  const someSelectedOnPage = useMemo(
    () => contacts.some(c => selectedIds.has(c['id'])) && !allSelectedOnPage,
    [contacts, selectedIds, allSelectedOnPage],
  );

  const toggleAllOnPage = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allOn = contacts.length > 0 && contacts.every(c => next.has(c['id']));
      if (allOn) {
        for (const c of contacts) next.delete(c['id']);
      } else {
        for (const c of contacts) next.add(c['id']);
      }
      return next;
    });
  }, [contacts]);

  // ── Real bulk-API integration ────────────────────────────────────────
  const callBulk = useCallback(async (
    action: 'delete' | 'tag' | 'untag' | 'assign' | 'status',
    payload?: Record<string, unknown>,
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/tenant/contacts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids, updates: payload ?? {} }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Bulk ${action} failed`);
        return;
      }
      const verb =
        action === 'delete' ? 'Deleted' :
        action === 'tag' ? 'Tagged' :
        action === 'untag' ? 'Untagged' :
        action === 'assign' ? 'Assigned' :
        'Updated';
      toast.success(`${verb} ${data.affected ?? ids.length} contacts`);
      setSelectedIds(new Set());
      load(offset);
    } catch {
      toast.error(`Bulk ${action} failed`);
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds, load, offset]);

  const bulkExportCSV = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/tenant/contacts/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        toast.error('Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${ids.length} contacts`);
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds]);

  const submitBulkPrompt = useCallback(async () => {
    if (!bulkPrompt) return;
    const value = bulkInput.trim();
    if (!value) { toast.error('Value required'); return; }
    if (bulkPrompt.kind === 'tag' || bulkPrompt.kind === 'untag') {
      await callBulk(bulkPrompt.kind, { tag: value });
    } else if (bulkPrompt.kind === 'assign') {
      await callBulk('assign', { assign_to: value });
    } else if (bulkPrompt.kind === 'status') {
      await callBulk('status', { lead_status: value });
    }
    setBulkPrompt(null);
    setBulkInput('');
  }, [bulkPrompt, bulkInput, callBulk]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center shrink-0 shadow-sm">
            <Users className="w-5 h-5 text-sky-600"/>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">Contacts</h1>
              <span className="text-xs font-extrabold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 rounded-full uppercase tracking-wider">{total.toLocaleString()}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Your contact database</p>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin">
          {/* View toggle - hidden on mobile since we use card view */}
          <div className="hidden md:flex items-center border border-border rounded-lg overflow-hidden text-xs bg-card shrink-0">
            <button onClick={()=>setView('list')} className={cn('px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1.5',view==='list'?'bg-accent text-foreground':'text-muted-foreground hover:bg-accent/50')}>
              <List className="w-3.5 h-3.5"/><span>List</span>
            </button>
            <button onClick={()=>setView('grid')} className={cn('px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1.5',view==='grid'?'bg-accent text-foreground':'text-muted-foreground hover:bg-accent/50')}>
              <Grid className="w-3.5 h-3.5"/><span>Grid</span>
            </button>
          </div>
          {permissions.canImport&&(
            <Button variant="outline" size="sm" className="gap-1.5 text-xs shrink-0 min-h-[44px]" onClick={()=>setShowImport(true)}>
              <Upload className="w-3.5 h-3.5"/>Import
            </Button>
          )}
          {permissions.canCreate&&(
            <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs shrink-0 shadow-md min-h-[44px]" onClick={()=>setShowAdd(true)}>
              <Plus className="w-3.5 h-3.5"/>New Contact
            </Button>
          )}
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        <button onClick={()=>handleStatus('all')} className={cn('px-3 py-1.5 rounded-full text-xs font-semibold transition-all border shrink-0',statusFilter==='all'?'bg-foreground text-background border-foreground':'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground')}>
          All contacts
        </button>
        {Object.entries(STATUS_CONFIG).map(([status,cfg])=>{
          return (
            <button key={status} onClick={()=>handleStatus(status)} className={cn('px-3 py-1.5 rounded-full text-xs font-semibold transition-all border flex items-center gap-1.5 shrink-0',statusFilter===status?`${cfg.color} border-current`:'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30')}>
              <div className={cn('w-1.5 h-1.5 rounded-full',cfg.dot)}/>{cfg.label}
            </button>
          );
        })}
      </div>

      {/* Search toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div className="relative w-full sm:flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
          <input value={search} onChange={e=>handleSearch(e.target.value)} placeholder="Search by name, email, company..." className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 shadow-sm"/>
          {search&&<button onClick={()=>handleSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5"/></button>}
        </div>
      </div>

      {/* List view */}
      {view==='list'&&(
        <div className="admin-card overflow-hidden">
          <div className="table-responsive">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    aria-label="Select all on page"
                    checked={allSelectedOnPage ? true : someSelectedOnPage ? 'indeterminate' : false}
                    onCheckedChange={() => toggleAllOnPage()}
                  />
                </th>
                {['Contact','Company','Email & Phone','Status','Lifecycle','Score','Added',''].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-extrabold text-foreground/80 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading&&<tr><td colSpan={8} className="py-16 text-center"><div className="flex items-center justify-center gap-2 text-muted-foreground text-sm"><div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"/>Loading contacts...</div></td></tr>}
              {!loading&&!contacts.length&&(
                <tr><td colSpan={8} className="py-20 text-center">
                  <div className="max-w-sm mx-auto">
                    <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-900/20 flex items-center justify-center mx-auto mb-4"><Users className="w-7 h-7 text-sky-400"/></div>
                    <p className="text-sm font-semibold mb-1">{search||statusFilter!=='all'?'No contacts match your filters':'No contacts yet'}</p>
                    <p className="text-xs text-muted-foreground mb-4">{search?'Try a different search term':'Add your first contact or import from CSV'}</p>
                    {!search&&statusFilter==='all'&&permissions.canCreate&&(
                      <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={()=>setShowAdd(true)}><Plus className="w-3.5 h-3.5 mr-1.5"/>Add Contact</Button>
                    )}
                  </div>
                </td></tr>
              )}
              {contacts.map(c=>{
                const status=STATUS_CONFIG[c['lead_status']]||STATUS_CONFIG['new'];
                const StatusIcon=status!.icon;
                const lifecycleColor=LIFECYCLE_COLORS[c['lifecycle_stage']]||'bg-slate-100 text-slate-600';
                return (
                  <tr key={c['id']} className={cn(
                    "border-b border-border last:border-0 hover:bg-accent/30 transition-colors cursor-pointer group",
                    selectedIds.has(c['id']) && "bg-violet-50/50 dark:bg-violet-900/10"
                  )} onClick={()=>router.push(`/tenant/contacts/${c['id']}`)}>
                    {/* Selection */}
                    <td className="w-10 px-4 py-3" onClick={e=>e.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select ${c['first_name']} ${c['last_name']}`}
                        checked={selectedIds.has(c['id'])}
                        onCheckedChange={() => toggleOne(c['id'])}
                      />
                    </td>
                    {/* Contact */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">
                          {getInitials(`${c['first_name'] ?? ''} ${c['last_name'] ?? ''}`)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold hover:text-violet-600 transition-colors truncate">{c['first_name']} {c['last_name']}</p>
                          {c['title']&&<p className="text-xs text-muted-foreground/80 truncate">{c['title']}</p>}
                          {c['assigned_name']&&!c['title']&&<p className="text-xs text-muted-foreground/80">→ {c['assigned_name']}</p>}
                        </div>
                      </div>
                    </td>
                    {/* Company */}
                    <td className="px-4 py-3">
                      {c['company_name']
                        ?<div className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0"/><span className="text-sm truncate max-w-[140px]">{c['company_name']}</span></div>
                        :<span className="text-sm text-muted-foreground">—</span>
                      }
                      {c['lead_source']&&<div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground/80"><Globe className="w-3 h-3"/>{SOURCE_LABELS[c['lead_source']]||c['lead_source']}</div>}
                    </td>
                    {/* Contact info */}
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {c['email']&&<a href={`mailto:${c['email']}`} onClick={e=>e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"><Mail className="w-3 h-3 shrink-0"/><span className="truncate max-w-[160px]">{c['email']}</span></a>}
                        {c['phone']&&<a href={`tel:${c['phone']}`} onClick={e=>e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"><Phone className="w-3 h-3 shrink-0"/>{c['phone']}</a>}
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold',status!.color)}>
                        <StatusIcon className="w-3 h-3"/>{status!.label}
                      </span>
                    </td>
                    {/* Lifecycle */}
                    <td className="px-4 py-3">
                      {c['lifecycle_stage']
                        ?<span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-bold capitalize',lifecycleColor)}>{c['lifecycle_stage']?.replace(/_/g,' ')}</span>
                        :<span className="text-xs text-muted-foreground">—</span>
                      }
                    </td>
                    {/* Score */}
                    <td className="px-4 py-3">
                      {c['score'] > 0 ? (() => {
                        const tier = getScoreTier(c['score']);
                        const cfg = getScoreTierConfig(tier);
                        return (
                          <div className="flex items-center gap-2">
                            <span className={cn('text-sm font-extrabold w-6', cfg.color)}>{c['score']}</span>
                            <div className="flex-1 h-1.5 w-12 bg-muted rounded-full overflow-hidden hidden xl:block">
                              <div className={cn('h-full', cfg.bar)} style={{ width: `${c['score']}%` }} />
                            </div>
                          </div>
                        );
                      })() : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    {/* Added */}
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDate(c['created_at'])}</td>
                    {/* Actions */}
                    <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                      <div className="flex items-center gap-1 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        {permissions.canDelete&&(
                          <button onClick={()=>deleteContact(c['id'],`${c['first_name']} ${c['last_name']}`)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors">
                            <X className="w-3.5 h-3.5"/>
                          </button>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground"/>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="px-4 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{contacts.length>0?offset+1:0}–{Math.min(offset+contacts.length,total)}</span> of <span className="font-semibold text-foreground">{total.toLocaleString()}</span>
            </p>
            <Pagination total={total} offset={offset} limit={limit} onChange={o=>load(o)}/>
          </div>
        </div>
      )}

      {/* Mobile card view */}
      <div className="space-y-3 md:hidden">
        {!contacts.length&&!loading&&(
          <div className="text-center py-20 rounded-xl border border-border bg-card">
            <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-900/20 flex items-center justify-center mx-auto mb-4"><Users className="w-7 h-7 text-sky-400"/></div>
            <p className="text-sm font-semibold mb-1">No contacts found</p>
            <p className="text-xs text-muted-foreground">Try adjusting your search or filters</p>
          </div>
        )}
        {contacts.map(c=>{
          const status=STATUS_CONFIG[c['lead_status']]||STATUS_CONFIG['new'];
          const _StatusIcon=status!.icon;
          return (
            <Swipeable
              key={c['id']}
              rightActions={[
                { label:'Edit', icon:<Edit className="w-5 h-5"/>, color:'text-white', bg:'bg-violet-500', onClick:()=>router.push(`/tenant/contacts/${c['id']}`) },
                ...(permissions.canDelete ? [{ label:'Delete', icon:<Trash2 className="w-5 h-5"/>, color:'text-white', bg:'bg-red-500', onClick:async()=>deleteContact(c['id'],`${c['first_name']} ${c['last_name']}`) }] : []),
              ]}
            >
              <div
                className="bg-card border border-border rounded-xl p-4 active:bg-accent/50 transition-colors"
                onClick={()=>router.push(`/tenant/contacts/${c['id']}`)}
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-sm shrink-0">
                    {getInitials(`${c['first_name'] ?? ''} ${c['last_name'] ?? ''}`)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{c['first_name']} {c['last_name']}</p>
                      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-bold',status!.color)}>
                        <div className={cn('w-1.5 h-1.5 rounded-full',status!.dot)}/>{status!.label}
                      </span>
                    </div>
                    {c['title']&&<p className="text-xs text-muted-foreground/80 truncate mt-0.5">{c['title']}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      {c['email']&&<div className="flex items-center gap-1 text-xs text-muted-foreground/80"><Mail className="w-3.5 h-3.5 shrink-0"/><span className="truncate">{c['email']}</span></div>}
                      {c['phone']&&<div className="flex items-center gap-1 text-xs text-muted-foreground/80"><Phone className="w-3.5 h-3.5 shrink-0"/><span>{c['phone']}</span></div>}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {c['company_name']&&<div className="flex items-center gap-1 text-xs text-muted-foreground/80"><Building2 className="w-3.5 h-3.5 shrink-0"/><span className="truncate">{c['company_name']}</span></div>}
                      {c['lifecycle_stage']&&<span className={cn('inline-flex px-1.5 py-0.5 rounded-full text-xs font-bold capitalize',LIFECYCLE_COLORS[c['lifecycle_stage']]||'bg-slate-100 text-slate-600')}>{c['lifecycle_stage']?.replace(/_/g,' ')}</span>}
                      {c['score'] > 0 && (() => {
                        const tier = getScoreTier(c['score']);
                        const cfg = getScoreTierConfig(tier);
                        return <span className={cn('inline-flex px-1.5 py-0.5 rounded-full text-xs font-bold', cfg.bg, cfg.color)}>{c['score']} Score</span>;
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </Swipeable>
          );
        })}
        <Pagination total={total} offset={offset} limit={limit} onChange={o=>load(o)}/>
      </div>

      {/* Grid view - desktop only */}
      {view==='grid'&&(
        <div className="hidden md:block space-y-4">
          {!contacts.length&&!loading&&(
            <div className="text-center py-20 rounded-xl border border-border bg-card">
              <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-900/20 flex items-center justify-center mx-auto mb-4"><Users className="w-7 h-7 text-sky-400"/></div>
              <p className="text-sm font-semibold mb-1">No contacts found</p>
              <p className="text-xs text-muted-foreground">Try adjusting your search or filters</p>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {contacts.map(c=>{
              const status=STATUS_CONFIG[c['lead_status']]||STATUS_CONFIG['new'];
              const _StatusIcon=status!.icon;
              return (
                <Link key={c['id']} href={`/tenant/contacts/${c['id']}`} className="group bg-card border border-border rounded-xl p-4 hover:border-violet-400/50 hover:shadow-sm transition-all block">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-sm">
                      {getInitials(`${c['first_name'] ?? ''} ${c['last_name'] ?? ''}`)}
                    </div>
                    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-bold',status!.color)}>
                      <div className={cn('w-1.5 h-1.5 rounded-full',status!.dot)}/>{status!.label}
                    </span>
                    {c['score'] > 0 && (() => {
                      const tier = getScoreTier(c['score']);
                      const cfg = getScoreTierConfig(tier);
                      return <span className={cn('absolute -top-1 -right-1 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold border-2 border-background shadow-sm', cfg.bg, cfg.color)} title={`Score: ${c['score']}`}>{c['score']}</span>;
                    })()}
                  </div>
                  <p className="text-sm font-semibold truncate group-hover:text-violet-600 transition-colors">{c['first_name']} {c['last_name']}</p>
                  {c['title']&&<p className="text-xs text-muted-foreground/80 truncate mt-0.5">{c['title']}</p>}
                  {c['company_name']&&(
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground/80">
                      <Building2 className="w-3 h-3 shrink-0"/><span className="truncate">{c['company_name']}</span>
                    </div>
                  )}
                  {c['email']&&(
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/80">
                      <Mail className="w-3 h-3 shrink-0"/><span className="truncate">{c['email']}</span>
                    </div>
                  )}
                  {c['last_activity_at']&&(
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground/80 border-t border-border/50 pt-2">
                      <Activity className="w-3 h-3"/>{formatDate(c['last_activity_at'])}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
          <Pagination total={total} offset={offset} limit={limit} onChange={o=>load(o)}/>
        </div>
      )}

      {showAdd&&<AddContactModal companies={companies} teamMembers={teamMembers} onClose={()=>setShowAdd(false)} onSuccess={()=>load(0)}/>}
      {showImport&&<ImportModal onDone={()=>{setShowImport(false);load(0);}} onClose={()=>setShowImport(false)}/>}

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          {
            label: 'Tag',
            icon: Tag,
            onClick: () => { setBulkInput(''); setBulkPrompt({ kind: 'tag', title: 'Add tag to selected contacts', placeholder: 'e.g. vip' }); },
          },
          {
            label: 'Untag',
            icon: X,
            onClick: () => { setBulkInput(''); setBulkPrompt({ kind: 'untag', title: 'Remove tag from selected contacts', placeholder: 'tag to remove' }); },
          },
          ...(permissions.canAssign && teamMembers.length > 0 ? [{
            label: 'Assign',
            icon: UserPlus,
            onClick: () => { setBulkInput(''); setBulkPrompt({ kind: 'assign' as const, title: 'Assign selected contacts to' }); },
          }] : []),
          {
            label: 'Status',
            icon: CircleDot,
            onClick: () => { setBulkInput('new'); setBulkPrompt({ kind: 'status', title: 'Change status of selected contacts' }); },
          },
          {
            label: 'Export',
            icon: Download,
            onClick: () => { void bulkExportCSV(); },
          },
          ...(permissions.canDelete ? [{
            label: 'Delete',
            icon: Trash2,
            variant: 'danger' as const,
            onClick: async () => {
              const count = selectedIds.size;
              if (count === 0) return;
              await confirmThen(`Delete ${count} contacts?`, async () => {
                await callBulk('delete');
              });
            },
          }] : []),
        ]}
      />

      {/* Bulk action input prompt */}
      {bulkPrompt && (
        <Dialog open onOpenChange={(o)=>{ if (!o) { setBulkPrompt(null); setBulkInput(''); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">{bulkPrompt.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              {bulkPrompt.kind === 'assign' ? (
                <select
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  value={bulkInput}
                  onChange={e => setBulkInput(e.target.value)}
                >
                  <option value="">Select team member…</option>
                  {teamMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
                  ))}
                </select>
              ) : bulkPrompt.kind === 'status' ? (
                <select
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  value={bulkInput}
                  onChange={e => setBulkInput(e.target.value)}
                >
                  {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  placeholder={'placeholder' in bulkPrompt ? bulkPrompt.placeholder : ''}
                  value={bulkInput}
                  onChange={e => setBulkInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitBulkPrompt(); } }}
                />
              )}
              <p className="text-xs text-muted-foreground/80">
                Affects {selectedIds.size} selected contact{selectedIds.size === 1 ? '' : 's'}.
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => { setBulkPrompt(null); setBulkInput(''); }}>Cancel</Button>
                <Button size="sm" disabled={bulkBusy || !bulkInput.trim()} onClick={() => void submitBulkPrompt()}>
                  {bulkBusy ? 'Working…' : 'Apply'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
