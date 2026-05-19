'use client';
import { useState, useEffect } from 'react';
import { MessageSquare, AlertTriangle, Clock, CheckCircle, ChevronDown, Search, User } from 'lucide-react';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

const PRI_CFG: Record<string,string> = { critical:'text-red-400 bg-red-500/15', high:'text-amber-400 bg-amber-500/15', normal:'text-blue-400 bg-blue-500/15', low:'text-white/40 bg-white/5' };
const STATUS_CFG: Record<string,string> = { open:'text-amber-400 bg-amber-500/15', in_progress:'text-blue-400 bg-blue-500/15', resolved:'text-emerald-400 bg-emerald-500/15', closed:'text-white/30 bg-white/5' };

export default function TicketsPage() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus]   = useState('open');
  const [search, setSearch]   = useState('');
  const [expanded, setExpanded] = useState<string|null>(null);
  const [reply, setReply]     = useState('');
  const [replying, setReplying] = useState<string|null>(null);

  const load = async () => {
    const q = status ? `?status=${status}` : '';
    const res = await fetch('/api/superadmin/tickets' + q);
    const d = await res.json(); setData(d); setLoading(false);
  };
  useEffect(() => { load(); }, [status]);

  const update = async (id: string, updates: any) => {
    await fetch('/api/superadmin/tickets',{ method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id,...updates}) });
    toast.success('Updated'); load();
  };

  const sendReply = async (id: string) => {
    if (!reply.trim()) return;
    setReplying(id);
    await fetch('/api/superadmin/tickets',{ method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id,status:'in_progress',admin_reply:reply}) });
    toast.success('Reply sent'); setReply(''); setReplying(null); load();
  };

  const c = data?.counts ?? {};
  const tickets = (data?.tickets ?? []).filter((t:any) => !search || t.subject?.toLowerCase()?.includes(search.toLowerCase()) || t.tenant_name?.toLowerCase()?.includes(search.toLowerCase()));

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2"><MessageSquare className="w-5 h-5 text-violet-400"/>Support Tickets</h1>
        <p className="text-xs text-white/30">Help requests from your tenants</p>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-4 gap-3">
        {[{label:'Open',v:c.open??0,color:'text-amber-400'},{label:'In Progress',v:c.in_progress??0,color:'text-blue-400'},{label:'Resolved',v:c.resolved??0,color:'text-emerald-400'},{label:'Critical',v:c.critical??0,color:'text-red-400'}].map(m=>(
          <div key={m.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-white/40">{m.label}</p>
            <p className={cn('text-xl font-bold mt-0.5',m.color)}>{m.v}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tickets..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500"/>
        </div>
        <div className="flex rounded-xl border border-white/10 overflow-hidden">
          {['open','in_progress','resolved',''].map((s,i)=>(
            <button key={i} onClick={()=>setStatus(s)}
              className={cn('px-3 py-2 text-xs font-medium transition-colors capitalize',status===s?'bg-white/10 text-white':'text-white/40 hover:text-white')}>
              {s||'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Tickets */}
      <div className="space-y-3">
        {loading ? <p className="text-white/30 text-sm">Loading...</p>
        : !tickets.length ? (
          <div className="text-center py-12 rounded-xl border border-white/10 bg-white/[0.02]">
            <CheckCircle className="w-10 h-10 text-emerald-500/30 mx-auto mb-3"/>
            <p className="text-white/30 text-sm">No tickets found</p>
          </div>
        ) : tickets.map((t:any) => {
          const isOpen = expanded===t.id;
          return (
            <div key={t.id} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
              <div className="flex items-start gap-3 px-5 py-4 cursor-pointer" onClick={()=>setExpanded(isOpen?null:t.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {t.priority && <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize',PRI_CFG[t.priority]||PRI_CFG['normal'])}>{t.priority}</span>}
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize',STATUS_CFG[t.status]||STATUS_CFG['open'])}>{t.status?.replace('_',' ')}</span>
                    {t.tenant_name && <span className="text-[10px] text-white/30">{t.tenant_name}</span>}
                  </div>
                  <p className="text-sm font-medium text-white">{t.subject||'No subject'}</p>
                  <p className="text-xs text-white/40 mt-0.5">{t.user_name||t.user_email} · {formatRelativeTime(t.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select value={t.status} onChange={e=>{e.stopPropagation();update(t.id,{status:e.target.value});}}
                    onClick={e=>e.stopPropagation()}
                    className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-white/50 focus:outline-none">
                    {['open','in_progress','resolved','closed'].map(s=><option key={s} value={s} className="bg-slate-900 capitalize">{s.replace('_',' ')}</option>)}
                  </select>
                  <ChevronDown className={cn('w-4 h-4 text-white/20 transition-transform',isOpen&&'rotate-180')}/>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-white/5 px-5 py-4 space-y-3">
                  {t.message && (
                    <div className="p-3 bg-white/5 rounded-lg">
                      <p className="text-xs font-semibold text-white/40 mb-1">Message</p>
                      <p className="text-sm text-white/70 whitespace-pre-wrap">{t.message}</p>
                    </div>
                  )}
                  {t.admin_reply && (
                    <div className="p-3 bg-violet-500/10 rounded-lg border border-violet-500/20">
                      <p className="text-xs font-semibold text-violet-400 mb-1">Your Reply</p>
                      <p className="text-sm text-white/70 whitespace-pre-wrap">{t.admin_reply}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <textarea value={reply} onChange={e=>setReply(e.target.value)}
                      placeholder="Reply to this ticket..." rows={2}
                      className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500 resize-none"/>
                    <button onClick={()=>sendReply(t.id)} disabled={!reply.trim()||replying===t.id}
                      className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors self-end">
                      {replying===t.id?'Sending...':'Reply'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
