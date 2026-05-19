'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Target, Plus, Filter, Download, Upload, Search, MoreHorizontal, Edit, Trash2,
  Phone, Mail, Building2, TrendingUp, Calendar, User, Star, Archive, RotateCcw,
  ChevronDown, CheckCircle, XCircle, Clock, ArrowRight, Zap, Eye, Activity,
  RefreshCcw, MapPin, Globe, Linkedin, DollarSign, Briefcase, AlertCircle,
  BarChart3, Users, X, SlidersHorizontal, Kanban, List, Flame
} from 'lucide-react';
import { cn, formatDate, formatCurrency, getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';
import LeadImportModal from '@/components/tenant/lead-import-modal';

const PIPELINE_CONFIG = {
  new:         { label: 'New',          color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',        ring: 'ring-slate-300',  dot: 'bg-slate-400',   icon: Star,        hex: '#94a3b8' },
  contacted:   { label: 'Contacted',    color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',             ring: 'ring-sky-300',    dot: 'bg-sky-500',     icon: Phone,       hex: '#0ea5e9' },
  qualified:   { label: 'Qualified',    color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', ring: 'ring-violet-300', dot: 'bg-violet-500',  icon: CheckCircle, hex: '#8b5cf6' },
  unqualified: { label: 'Disqualified', color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',             ring: 'ring-red-300',    dot: 'bg-red-500',     icon: XCircle,     hex: '#ef4444' },
  converted:   { label: 'Converted',    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', ring: 'ring-emerald-300', dot: 'bg-emerald-500', icon: Zap,      hex: '#10b981' },
  lost:        { label: 'Lost',         color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',            ring: 'ring-gray-300',   dot: 'bg-gray-400',    icon: Archive,     hex: '#6b7280' },
  nurturing:   { label: 'Nurturing',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',     ring: 'ring-amber-300',  dot: 'bg-amber-500',   icon: RotateCcw,   hex: '#f59e0b' },
};

const LIFECYCLE_STAGES = {
  visitor:                  { label: 'Visitor',     icon: Eye },
  lead:                     { label: 'Lead',        icon: Target },
  marketing_qualified_lead: { label: 'MQL',         icon: Star },
  sales_qualified_lead:     { label: 'SQL',         icon: CheckCircle },
  opportunity:              { label: 'Opportunity', icon: TrendingUp },
  customer:                 { label: 'Customer',    icon: Zap },
  evangelist:               { label: 'Evangelist',  icon: Users },
};

const AUTHORITY_LEVELS = {
  decision_maker: { label: 'Decision Maker', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  influencer:     { label: 'Influencer',     color: 'text-sky-600 dark:text-sky-400',         bg: 'bg-sky-50 dark:bg-sky-900/20' },
  user:           { label: 'End User',       color: 'text-gray-600 dark:text-gray-400',       bg: 'bg-gray-50 dark:bg-gray-900/20' },
  unknown:        { label: 'Unknown',        color: 'text-muted-foreground',                  bg: '' },
};

const SOURCE_LABELS: Record<string,string> = {
  website:'Website', referral:'Referral', cold_outreach:'Cold Outreach',
  social_media:'Social', event:'Event', inbound:'Inbound', advertisement:'Ad', other:'Other',
};

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const bar = pct>=75?'bg-emerald-500':pct>=50?'bg-amber-500':pct>=25?'bg-orange-500':'bg-red-400';
  const txt = pct>=75?'text-emerald-600':pct>=50?'text-amber-600':pct>=25?'text-orange-500':'text-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all',bar)} style={{width:`${pct}%`}}/>
      </div>
      <span className={cn('text-xs font-bold tabular-nums',txt)}>{pct}</span>
    </div>
  );
}

function KanbanColumn({ status, leads, onNavigate }: any) {
  const cfg = PIPELINE_CONFIG[status as keyof typeof PIPELINE_CONFIG];
  const Icon = cfg.icon;
  return (
    <div className="flex-1 min-w-[220px] max-w-[280px]">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={cn('w-2 h-2 rounded-full',cfg.dot)}/>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{cfg.label}</span>
        <span className="ml-auto text-xs font-bold text-muted-foreground bg-muted rounded-full px-2 py-0.5">{leads.length}</span>
      </div>
      <div className="space-y-2 min-h-[200px]">
        {leads.map((lead:any) => (
          <div key={lead.id} onClick={()=>onNavigate(lead.id)}
            className="bg-card border border-border rounded-xl p-3 cursor-pointer hover:border-violet-400/50 hover:shadow-sm transition-all">
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {getInitials(`${lead.first_name} ${lead.last_name}`)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{lead.first_name} {lead.last_name}</p>
                {lead.company_name&&<p className="text-[10px] text-muted-foreground truncate">{lead.company_name}</p>}
              </div>
            </div>
            {lead.budget&&<div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600 font-semibold"><DollarSign className="w-3 h-3"/>{formatCurrency(lead.budget)}</div>}
            {lead.score>0&&<div className="mt-1.5"><ScoreBadge score={lead.score}/></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickAddModal({ companies, teamMembers, onClose, onSuccess }: any) {
  const [data,setData]=useState({first_name:'',last_name:'',email:'',phone:'',title:'',company_name:'',lead_source:'website',budget:'',timeline:'',authority_level:'unknown',assigned_to:'',tags:''});
  const [saving,setSaving]=useState(false);
  const handle=async(e:React.FormEvent)=>{
    e.preventDefault();setSaving(true);
    try{
      const tagsArray = data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const res=await fetch('/api/tenant/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ ...data, tags: tagsArray })});
      const json=await res.json();
      if(!res.ok){toast.error(json.error||'Failed');return;}
      toast.success('Lead created!');onSuccess();onClose();
    }finally{setSaving(false);}
  };
  const inp="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-shadow";
  const lbl="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide";
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <Target className="w-3.5 h-3.5 text-violet-600"/>
            </div>
            New Lead
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handle} className="mt-2 space-y-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2"><User className="w-3 h-3"/>Identity</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>First Name *</label><input className={inp} value={data.first_name} onChange={e=>setData(p=>({...p,first_name:e.target.value}))} required/></div>
              <div><label className={lbl}>Last Name</label><input className={inp} value={data.last_name} onChange={e=>setData(p=>({...p,last_name:e.target.value}))}/></div>
              <div><label className={lbl}>Email *</label><input className={inp} type="email" value={data.email} onChange={e=>setData(p=>({...p,email:e.target.value}))} required/></div>
              <div><label className={lbl}>Phone</label><input className={inp} type="tel" value={data.phone} onChange={e=>setData(p=>({...p,phone:e.target.value}))}/></div>
              <div><label className={lbl}>Job Title</label><input className={inp} placeholder="e.g. VP Sales" value={data.title} onChange={e=>setData(p=>({...p,title:e.target.value}))}/></div>
              <div><label className={lbl}>Company</label>
                <select className={inp} value={data.company_name} onChange={e=>setData(p=>({...p,company_name:e.target.value}))}>
                  <option value="">No company</option>
                  {(companies||[]).map((c:any)=>(<option key={c.id} value={c.name}>{c.name}</option>))}
                </select>
              </div>
            </div>
          </div>
          <div className="border-t border-border/50 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2"><BarChart3 className="w-3 h-3"/>Qualification (BANT)</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Budget (USD)</label><input className={inp} type="number" placeholder="e.g. 50000" value={data.budget} onChange={e=>setData(p=>({...p,budget:e.target.value}))}/></div>
              <div><label className={lbl}>Authority Level</label>
                <select className={inp} value={data.authority_level} onChange={e=>setData(p=>({...p,authority_level:e.target.value}))}>
                  <option value="unknown">Unknown</option><option value="decision_maker">Decision Maker</option>
                  <option value="influencer">Influencer</option><option value="user">End User</option>
                </select>
              </div>
              <div><label className={lbl}>Timeline</label>
                <select className={inp} value={data.timeline} onChange={e=>setData(p=>({...p,timeline:e.target.value}))}>
                  <option value="">Select...</option><option value="immediate">Immediate</option>
                  <option value="1-3 months">1–3 Months</option><option value="3-6 months">3–6 Months</option>
                  <option value="6-12 months">6–12 Months</option><option value="12+ months">12+ Months</option>
                </select>
              </div>
              <div><label className={lbl}>Lead Source</label>
                <select className={inp} value={data.lead_source} onChange={e=>setData(p=>({...p,lead_source:e.target.value}))}>
                  {Object.entries(SOURCE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="col-span-2"><label className={lbl}>Tags (comma separated)</label><input className={inp} placeholder="e.g. high-value, tech-industry" value={data.tags} onChange={e=>setData(p=>({...p,tags:e.target.value}))}/></div>
            </div>
          </div>
          {teamMembers.length>0&&(
            <div className="border-t border-border/50 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2"><Users className="w-3 h-3"/>Assignment</p>
              <select className={inp} value={data.assigned_to} onChange={e=>setData(p=>({...p,assigned_to:e.target.value}))}>
                <option value="">Unassigned</option>
                {teamMembers.map((m:any)=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1 bg-violet-600 hover:bg-violet-700 text-white" disabled={saving}>{saving?'Creating...':'Create Lead'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Props {
  permissions: Record<string,boolean>;
  teamMembers: any[];
  companies: any[];
  stats: any[];
  sources: any[];
  tenantId: string;
  userId: string;
}

interface Lead {
  id:string; first_name:string; last_name:string; email:string; phone:string;
  company_name:string; title:string; lead_status:string; lead_source:string;
  score:number; lifecycle_stage:string; budget:number; authority_level:string;
  timeline:string; assigned_to:string; assigned_name:string;
  last_activity_at:string; created_at:string; country:string; city:string; linkedin_url:string;
  tags?: string[];
}

export default function LeadsClientNew({ permissions, teamMembers, companies, stats, sources, tenantId, userId }: Props) {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [viewMode, setViewMode] = useState<'table'|'kanban'>('table');
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  
  const lastRequestTime = useRef(0);

  const statsMap = useMemo(()=>{const m:Record<string,number>={};stats.forEach(s=>{m[s.lead_status]=Number(s.count);});return m;},[stats]);
  const totalLeads = useMemo(()=>Object.values(statsMap).reduce((a,b)=>a+b,0),[statsMap]);
  const conversionRate = totalLeads>0?Math.round(((statsMap['converted']||0)/totalLeads)*100):0;

  const load = useCallback(async(newOffset=0,status=activeStatus,q=debouncedSearch)=>{
    const requestTime = Date.now();
    lastRequestTime.current = requestTime;
    setLoading(true);
    try{
      const params=new URLSearchParams({limit:String(limit),offset:String(newOffset),sort_by:sortBy,sort_order:sortOrder});
      if(status!=='all')params.set('lead_status',status);
      if(q)params.set('q',q);
      
      const res=await fetch('/api/tenant/leads?'+params);
      if (!res.ok) throw new Error('Failed to fetch');
      
      const data=await res.json();
      
      if (lastRequestTime.current === requestTime && data) {
        setLeads(Array.isArray(data.data) ? data.data : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setOffset(newOffset);
        
        // Small delay before removing loading state for smoother UI
        setTimeout(() => {
          if (lastRequestTime.current === requestTime) {
            setLoading(false);
          }
        }, 250);
      }
    } catch (err) {
      console.error('[Leads load error]', err);
      setLoading(false);
    }
  },[sortBy,sortOrder,limit, debouncedSearch, activeStatus]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      // Only trigger search if query is empty or >= 2 chars
      if (search.length === 0 || search.length >= 2) {
        setDebouncedSearch(search);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(()=>{
    load(0, activeStatus, debouncedSearch);
  }, [debouncedSearch, activeStatus, sortBy, sortOrder]);

  const handleSearch=(q:string)=>{setSearch(q);};
  const handleStatus=(s:string)=>{setActiveStatus(s);};

  const updateLeadStatus=async(id:string,status:string)=>{
    const res=await fetch(`/api/tenant/leads/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead_status:status})});
    if(res.ok){toast.success('Status updated');load(offset,activeStatus,debouncedSearch);}else toast.error('Failed');
  };

  const deleteLead=async(id:string,name:string)=>{
    await confirmThen(`Delete ${name}?`, async () => {
      const res=await fetch(`/api/tenant/leads/${id}`,{method:'DELETE'});
      if(res.ok){toast.success('Lead deleted');load(offset,activeStatus,debouncedSearch);}else toast.error('Failed');
    });
  };

  const toggleSelect=(id:string)=>setSelectedLeads(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});

  const kanbanGroups=useMemo(()=>{
    const g:Record<string,Lead[]>={};Object.keys(PIPELINE_CONFIG).forEach(s=>{g[s]=[];});
    leads.forEach(l=>{if(g[l.lead_status])g[l.lead_status]!.push(l);else g['new']!.push(l);});return g;
  },[leads]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0 shadow-sm">
            <Target className="w-5 h-5 text-violet-600"/>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">Leads</h1>
              <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 px-2 py-0.5 rounded-full uppercase tracking-wider">{total.toLocaleString()}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Sales pipeline management</p>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin">
          <div className="flex items-center border border-border rounded-lg overflow-hidden text-xs shrink-0 bg-card">
            <button onClick={()=>setViewMode('table')} className={cn('px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1.5',viewMode==='table'?'bg-accent text-foreground':'text-muted-foreground hover:bg-accent/50')}>
              <List className="w-3.5 h-3.5"/><span>List</span>
            </button>
            <button onClick={()=>setViewMode('kanban')} className={cn('px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1.5',viewMode==='kanban'?'bg-accent text-foreground':'text-muted-foreground hover:bg-accent/50')}>
              <Kanban className="w-3.5 h-3.5"/><span>Board</span>
            </button>
          </div>
          {permissions['canCreate']&&(
            <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs shrink-0 shadow-md" onClick={()=>setShowQuickAdd(true)}>
              <Plus className="w-3.5 h-3.5"/>New Lead
            </Button>
          )}
          {permissions['canImport']&&<Button variant="outline" size="sm" className="gap-1.5 text-xs shrink-0" onClick={()=>setShowImport(true)}><Upload className="w-3.5 h-3.5"/><span className="hidden sm:inline">Import</span></Button>}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="flex sm:grid sm:grid-cols-4 lg:grid-cols-8 gap-2 overflow-x-auto sm:overflow-x-hidden pb-2 sm:pb-0 scrollbar-thin">
        <button onClick={()=>handleStatus('all')} className={cn('rounded-xl border p-3 text-left transition-all hover:shadow-sm shrink-0 min-w-[130px] sm:min-w-0',activeStatus==='all'?'border-violet-500/50 bg-violet-50 dark:bg-violet-900/10':'border-border bg-card')}>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">All Leads</p>
          <p className="text-xl font-bold mt-0.5">{totalLeads.toLocaleString()}</p>
          <div className="mt-1 flex items-center gap-1 text-[9px] text-emerald-600 font-bold"><Flame className="w-2.5 h-2.5"/>{conversionRate}% Rate</div>
        </button>
        {Object.entries(PIPELINE_CONFIG).map(([status,cfg])=>{
          const cnt=statsMap[status]||0;
          return (
            <button key={status} onClick={()=>handleStatus(status)} className={cn('rounded-xl border p-3 text-left transition-all hover:shadow-sm shrink-0 min-w-[130px] sm:min-w-0',activeStatus===status?`${cfg.ring} ring-1 bg-accent/50`:'border-border bg-card')}>
              <div className="flex items-center justify-between"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground truncate">{cfg.label}</p><div className={cn('w-1.5 h-1.5 rounded-full shrink-0',cfg.dot)}/></div>
              <p className="text-xl font-bold mt-0.5">{cnt.toLocaleString()}</p>
              <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden"><div className={cn('h-full rounded-full',cfg.dot)} style={{width:totalLeads>0?`${(cnt/totalLeads)*100}%`:'0%'}}/></div>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-md">
          <Search className={cn("absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors", loading ? "text-violet-500 animate-pulse" : "text-muted-foreground")}/>
          <input 
            value={search} 
            onChange={e=>handleSearch(e.target.value)} 
            placeholder="Search by name, email, phone, company, city..." 
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 shadow-sm"
          />
          {search&&<button onClick={()=>handleSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5"/></button>}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs flex-1 sm:flex-none">Sort <ChevronDown className="w-3 h-3"/></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={()=>{setSortBy('created_at');setSortOrder('DESC');}}>Newest First</DropdownMenuItem>
              <DropdownMenuItem onClick={()=>{setSortBy('score');setSortOrder('DESC');}}>Highest Score</DropdownMenuItem>
              <DropdownMenuItem onClick={()=>{setSortBy('last_activity_at');setSortOrder('DESC');}}>Recent Activity</DropdownMenuItem>
              <DropdownMenuItem onClick={()=>{setSortBy('budget');setSortOrder('DESC');}}>Highest Budget</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button variant="outline" size="sm" className="w-9 h-9 p-0 sm:hidden">
            <Filter className="w-4 h-4" />
          </Button>
        </div>

        {selectedLeads.size>0&&(
          <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl text-xs font-medium text-violet-700 dark:text-violet-400 w-full sm:w-auto overflow-x-auto">
            <span className="shrink-0">{selectedLeads.size} selected</span>
            <div className="h-4 w-px bg-violet-200 dark:bg-violet-800 mx-1 shrink-0"/>
            <button onClick={async()=>{
              const res=await fetch('/api/tenant/leads/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',lead_ids:Array.from(selectedLeads)})});
              if(res.ok){toast.success(`${selectedLeads.size} leads deleted`);setSelectedLeads(new Set());load();}
              else toast.error('Bulk delete failed');
            }} className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 shrink-0">Delete</button>
            <button onClick={async()=>{
              const res=await fetch('/api/tenant/leads/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status',lead_ids:Array.from(selectedLeads),payload:{lead_status:'qualified'}})});
              if(res.ok){toast.success(`${selectedLeads.size} leads qualified`);setSelectedLeads(new Set());load();}
              else toast.error('Bulk status failed');
            }} className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 shrink-0">Qualify</button>
            <button onClick={()=>setSelectedLeads(new Set())} className="ml-auto shrink-0"><X className="w-3.5 h-3.5"/></button>
          </div>
        )}
      </div>

      {/* Kanban */}
      {viewMode==='kanban'&&(
        <div className={cn("overflow-x-auto pb-4 scrollbar-thin transition-opacity", loading && "opacity-60")}>
          <div className="flex gap-3 min-w-max">
            {Object.keys(PIPELINE_CONFIG).map(status=>(
              <KanbanColumn key={status} status={status} leads={kanbanGroups[status]||[]} onNavigate={(id:string)=>router.push(`/tenant/leads/${id}`)}/>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {viewMode==='table'&&(
        <div className="rounded-xl border border-border bg-card overflow-x-auto shadow-sm scrollbar-thin">
          <div className="sm:min-w-[700px] min-w-[500px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 w-10"><input type="checkbox" className="rounded border-border" onChange={e=>{e.target.checked?setSelectedLeads(new Set(leads.map(l=>l.id))):setSelectedLeads(new Set());}} checked={selectedLeads.size===leads.length&&leads.length>0}/></th>
                {['Lead','Company','Contact','Status','Score','BANT','Activity',''].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && leads.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                      <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"/>
                      Loading leads...
                    </div>
                  </td>
                </tr>
              )}
              {!loading&&leads.length===0&&(
                <tr><td colSpan={9} className="py-20 text-center">
                  <div className="max-w-sm mx-auto">
                    <div className="w-14 h-14 rounded-2xl bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center mx-auto mb-4"><Target className="w-7 h-7 text-violet-400"/></div>
                    <p className="text-sm font-semibold mb-1">{search||activeStatus!=='all'?'No leads match your filters':'No leads yet'}</p>
                    <p className="text-xs text-muted-foreground mb-4">{search?'Try a different search term':'Start building your pipeline'}</p>
                    {!search&&activeStatus==='all'&&permissions['canCreate']&&(
                      <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={()=>setShowQuickAdd(true)}><Plus className="w-3.5 h-3.5 mr-1.5"/>Add First Lead</Button>
                    )}
                  </div>
                </td></tr>
              )}
              {leads.map(lead=>{
                const cfg=PIPELINE_CONFIG[lead.lead_status as keyof typeof PIPELINE_CONFIG]||PIPELINE_CONFIG.new;
                const StatusIcon=cfg.icon;
                const lifecycle=LIFECYCLE_STAGES[lead.lifecycle_stage as keyof typeof LIFECYCLE_STAGES];
                const authority=AUTHORITY_LEVELS[lead.authority_level as keyof typeof AUTHORITY_LEVELS];
                return (
                  <tr key={lead.id} className={cn('border-b border-border last:border-0 hover:bg-accent/30 transition-colors group',selectedLeads.has(lead.id)&&'bg-violet-50/50 dark:bg-violet-900/10', loading && 'opacity-60 grayscale-[0.2]')}>
                    <td className="px-4 py-3"><input type="checkbox" checked={selectedLeads.has(lead.id)} onChange={()=>toggleSelect(lead.id)} className="rounded border-border"/></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 cursor-pointer" onClick={()=>router.push(`/tenant/leads/${lead.id}`)}>
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">{getInitials(`${lead.first_name} ${lead.last_name}`)}</div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold hover:text-violet-600 transition-colors truncate">{lead.first_name} {lead.last_name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {lead.title&&<span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{lead.title}</span>}
                            {lifecycle&&<Badge variant="secondary" className="text-[9px] h-3.5 px-1.5 gap-0.5"><lifecycle.icon className="w-2 h-2"/>{lifecycle.label}</Badge>}
                            {Array.isArray(lead.tags) && lead.tags.slice(0, 2).map((tag: string) => (
                              <span key={tag} className="text-[9px] bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0 rounded font-medium border border-blue-100 dark:border-blue-800">
                                {tag}
                              </span>
                            ))}
                            {Array.isArray(lead.tags) && lead.tags.length > 2 && (
                              <span className="text-[9px] text-muted-foreground">+{lead.tags.length - 2}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {lead.company_name?<div className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0"/><span className="text-sm truncate max-w-[140px]">{lead.company_name}</span></div>:<span className="text-sm text-muted-foreground">—</span>}
                      {lead.assigned_name&&<div className="flex items-center gap-1 mt-0.5"><User className="w-2.5 h-2.5 text-muted-foreground"/><span className="text-[10px] text-muted-foreground">{lead.assigned_name}</span></div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {lead.email&&<a href={`mailto:${lead.email}`} onClick={e=>e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><Mail className="w-3 h-3 shrink-0"/><span className="truncate max-w-[140px]">{lead.email}</span></a>}
                        {lead.phone&&<a href={`tel:${lead.phone}`} onClick={e=>e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><Phone className="w-3 h-3 shrink-0"/>{lead.phone}</a>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all hover:opacity-80',cfg.color)}>
                            <StatusIcon className="w-3 h-3"/>{cfg.label}<ChevronDown className="w-2.5 h-2.5 opacity-60"/>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Change Status</DropdownMenuLabel>
                          <DropdownMenuSeparator/>
                          {Object.entries(PIPELINE_CONFIG).map(([id,c])=>(
                            <DropdownMenuItem key={id} onClick={()=>updateLeadStatus(lead.id,id)} className="gap-2">
                              <div className={cn('w-2 h-2 rounded-full',c.dot)}/>{c.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                    <td className="px-4 py-3"><ScoreBadge score={lead.score||0}/></td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {lead.budget&&<div className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><DollarSign className="w-3 h-3"/>{formatCurrency(lead.budget)}</div>}
                        {authority&&lead.authority_level!=='unknown'&&<span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded',authority.bg,authority.color)}>{authority.label}</span>}
                        {lead.timeline&&<div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="w-2.5 h-2.5"/>{lead.timeline}</div>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Activity className="w-3 h-3 shrink-0"/>{lead.last_activity_at?<span>{formatDate(lead.last_activity_at)}</span>:<span className="italic">No activity</span>}</div>
                      {lead.lead_source&&<div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground"><Globe className="w-2.5 h-2.5"/>{SOURCE_LABELS[lead.lead_source]||lead.lead_source}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1.5 rounded-lg hover:bg-accent transition-colors max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100"><MoreHorizontal className="w-4 h-4 text-muted-foreground"/></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={()=>router.push(`/tenant/leads/${lead.id}`)}><Eye className="w-4 h-4 mr-2"/>View Details</DropdownMenuItem>
                          <DropdownMenuItem onClick={()=>router.push(`/tenant/leads/${lead.id}?tab=activities`)}><Activity className="w-4 h-4 mr-2"/>Log Activity</DropdownMenuItem>
                          {lead.linkedin_url&&<DropdownMenuItem onClick={()=>window.open(lead.linkedin_url,'_blank')}><Linkedin className="w-4 h-4 mr-2"/>LinkedIn</DropdownMenuItem>}
                          <DropdownMenuSeparator/>
                          <DropdownMenuItem onClick={()=>deleteLead(lead.id,`${lead.first_name} ${lead.last_name}`)} className="text-red-600 focus:text-red-600"><Trash2 className="w-4 h-4 mr-2"/>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {leads.length>0&&(
            <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/10">
              <p className="text-xs text-muted-foreground">Showing <span className="font-semibold text-foreground">{offset+1}–{Math.min(offset+leads.length,total)}</span> of <span className="font-semibold text-foreground">{total.toLocaleString()}</span> leads</p>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={()=>load(Math.max(0,offset-limit),activeStatus,debouncedSearch)} disabled={offset===0 || loading}>← Prev</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={()=>load(offset+limit,activeStatus,debouncedSearch)} disabled={offset+leads.length>=total || loading}>Next →</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {showQuickAdd&&<QuickAddModal companies={companies} teamMembers={teamMembers} onClose={()=>setShowQuickAdd(false)} onSuccess={()=>load(0,activeStatus,debouncedSearch)}/>}
      {showImport&&<LeadImportModal onDone={()=>{load(0,activeStatus,debouncedSearch);setShowImport(false);}} onClose={()=>setShowImport(false)}/>}
    </div>
  );
}
