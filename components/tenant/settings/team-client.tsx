'use client';
import { useState } from 'react';
import { Users, Plus, X, Mail, Crown, Shield, UserMinus, RotateCcw,
  ChevronDown, AlertTriangle, CheckCircle, Clock, UserCheck, ArrowRight, Loader2 } from 'lucide-react';
import { cn, formatDate, formatRelativeTime, getInitials } from '@/lib/utils';
import toast from 'react-hot-toast';

const ROLE_COLORS: Record<string,string> = {
  admin:        'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  lead_manager: 'bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
  manager:      'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  sales_rep:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  viewer:       'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const ROLE_DESCRIPTIONS: Record<string,string> = {
  admin:        'Full access. Can delete anything. Can manage all team members.',
  lead_manager: 'Assign & revoke leads/contacts. Cannot delete data.',
  manager:      'View all. Create & edit. Cannot delete. Can invite.',
  sales_rep:    'Create & edit own records only. Cannot view others.',
  viewer:       'Read-only access to all records.',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RemoveMemberModal({ member, members, onConfirm, onClose }: any) {
  const [reassignTo, setReassignTo] = useState('');
  const [reason, setReason] = useState('');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const otherMembers = members.filter((m:any) => m.user_id !== member.user_id && m.role_slug !== 'viewer');
  const hasData = (member.contact_count||0)+(member.deal_count||0)+(member.task_count||0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.6)'}}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
            <UserMinus className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-bold">Remove {member.full_name||member.email}?</h3>
            <p className="text-xs text-muted-foreground">Their account stays — only workspace access is removed</p>
          </div>
        </div>

        {hasData && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5"/>This member owns data:
            </p>
            <div className="flex gap-3 text-xs text-amber-600">
              {member.contact_count>0 && <span>{member.contact_count} contacts</span>}
              {member.deal_count>0 && <span>{member.deal_count} deals</span>}
              {member.task_count>0 && <span>{member.task_count} open tasks</span>}
            </div>
            <div>
              <label className="block text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Reassign data to</label>
              <select value={reassignTo} onChange={e=>setReassignTo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">Reassign to me (admin)</option>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {otherMembers.map((m:any) => <option key={m.user_id} value={m.user_id}>{m.full_name||m.email} ({m.role_slug})</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 rounded-xl">
          <p className="text-xs text-blue-600 dark:text-blue-400 flex items-start gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5"/>
            <span><strong>No data is deleted.</strong> All contacts, deals, notes, and activity history are preserved and reassigned. The user's account remains — they just lose access to this workspace.</span>
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Reason (optional)</label>
          <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Left company, role change..." className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-border text-sm hover:bg-accent transition-colors">Cancel</button>
          <button onClick={() => onConfirm(reassignTo, reason)}
            className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors">
            Remove & Reassign Data
          </button>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function TeamSettingsClient({ members: initialMembers, invitations: initialInvitations, roles, _tenantId, currentUserId }: any) {
  const [members, setMembers]         = useState(initialMembers ?? []);
  const [invitations, setInvitations] = useState(initialInvitations ?? []);
  const [showInvite, setShowInvite]   = useState(false);
  const [mode, setMode]               = useState<'invite' | 'direct'>('invite');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('sales_rep');
  const [fullName, setFullName]       = useState('');
  const [password, setPassword]       = useState('');
  const [inviting, setInviting]       = useState(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [removeModal, setRemoveModal] = useState<any>(null);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const reload = async () => {
    const res = await fetch('/api/tenant/members');
    const d = await res.json();
    setMembers(d.data||[]); setInvitations(d.invitations||[]);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setInviting(true);
    
    try {
      if (mode === 'invite') {
        const res = await fetch('/api/tenant/invite/send',{ 
          method:'POST', 
          headers:{'Content-Type':'application/json'}, 
          body:JSON.stringify({email:inviteEmail,roleSlug:inviteRole}) 
        });
        const d = await res.json();
        if (res.ok) { 
          toast.success(`Invitation sent to ${inviteEmail}`); 
          setShowInvite(false); 
          setInviteEmail(''); 
          reload(); 
        } else toast.error(d.error);
      } else {
        const res = await fetch('/api/tenant/members',{ 
          method:'POST', 
          headers:{'Content-Type':'application/json'}, 
          body:JSON.stringify({
            email: inviteEmail,
            password: password,
            full_name: fullName,
            role_slug: inviteRole
          }) 
        });
        const d = await res.json();
        if (res.ok) { 
          toast.success(`Member ${fullName} created successfully`); 
          setShowInvite(false); 
          setInviteEmail('');
          setFullName('');
          setPassword('');
          reload(); 
        } else toast.error(d.error);
      }
    } catch {
      toast.error('Failed to add member');
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (memberId: string, roleSlug: string) => {
    const res = await fetch('/api/tenant/members',{ method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({memberId,action:'change_role',roleSlug}) });
    const d = await res.json();
    if (res.ok) { toast.success('Role updated'); reload(); }
    else toast.error(d.error);
  };

  const removeMember = async (reassignTo: string, reason: string) => {
    const m = removeModal;
    const res = await fetch('/api/tenant/members',{ method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({memberId:m.id,action:'remove',reassignTo,reason}) });
    const d = await res.json();
    if (res.ok) { toast.success(`${m.full_name||m.email} removed. Data reassigned.`); setRemoveModal(null); reload(); }
    else toast.error(d.error);
  };

  const cancelInvite = async (inviteId: string) => {
    await fetch(`/api/tenant/invite/${inviteId}`,{ method:'DELETE' });
    toast.success('Invitation cancelled'); reload();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {removeModal && <RemoveMemberModal member={removeModal} members={members} onConfirm={removeMember} onClose={()=>setRemoveModal(null)}/>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5"/>Team</h1>
          <p className="text-sm text-muted-foreground">{members.length} active member{members.length!==1?'s':''}</p>
        </div>
        <button onClick={()=>setShowInvite(s=>!s)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4"/>{showInvite ? 'Hide Form' : 'Add Team Member'}
        </button>
      </div>

      {/* Roles info */}
      <div className="admin-card p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Role Capabilities</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {Object.entries(ROLE_DESCRIPTIONS).map(([slug,desc]) => (
            <div key={slug} className="flex items-start gap-2">
              <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 capitalize', ROLE_COLORS[slug]||ROLE_COLORS["viewer"])}>
                {slug.replace('_',' ')}
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Add Member form */}
      {showInvite && (
        <form onSubmit={handleAddMember} className="admin-card p-5 space-y-4 border-2 border-violet-500/20 shadow-lg shadow-violet-500/5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <p className="text-sm font-semibold">{mode === 'invite' ? 'Invite Team Member' : 'Create Team Member'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {mode === 'invite' ? 'User will receive an email to join' : 'User account will be created immediately'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg shrink-0">
              <button type="button" onClick={() => setMode('invite')} className={cn('px-3 py-1 text-[10px] font-bold rounded-md transition-all', mode === 'invite' ? 'bg-background shadow-sm text-violet-600' : 'text-muted-foreground')}>INVITE</button>
              <button type="button" onClick={() => setMode('direct')} className={cn('px-3 py-1 text-[10px] font-bold rounded-md transition-all', mode === 'direct' ? 'bg-background shadow-sm text-violet-600' : 'text-muted-foreground')}>DIRECT</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email Address *</label>
              <input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} required placeholder="colleague@company.com" className={inp} autoFocus/>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Role</label>
              <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} className={inp}>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {roles.filter((r:any)=>r.slug!=='admin').map((r:any)=>(
                  <option key={r.id} value={r.slug}>{r.name}</option>
                ))}
              </select>
            </div>

            {mode === 'direct' && (
              <>
                <div className="col-span-2 sm:col-span-1 animate-in slide-in-from-left-1 duration-200">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Full Name *</label>
                  <input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} required placeholder="John Doe" className={inp}/>
                </div>
                <div className="col-span-2 sm:col-span-1 animate-in slide-in-from-right-1 duration-200">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password *</label>
                  <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••" className={inp}/>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 pt-2">
            <p className="text-[10px] text-muted-foreground flex-1">
              {ROLE_DESCRIPTIONS[inviteRole] || 'Custom role permissions will apply.'}
            </p>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={()=>setShowInvite(false)} className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-accent transition-colors">Cancel</button>
              <button type="submit" disabled={inviting} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-all shadow-md active:scale-95">
                {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : (mode === 'invite' ? <><Mail className="w-3.5 h-3.5"/>Send Invite</> : <><Plus className="w-3.5 h-3.5"/>Create Account</>)}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Members list */}
      <div className="admin-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <p className="text-sm font-semibold">Active Members ({members.length})</p>
        </div>
        <div className="divide-y divide-border">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          {members.map((m:any) => {
            const isMe = m.user_id === currentUserId;
            const isAdmin = m.role_slug === 'admin';
            return (
              <div key={m.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {getInitials(m.full_name||m.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{m.full_name||'—'}</p>
                    {isMe && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">You</span>}
                    {m.email_verified === false && <span className="text-[10px] bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 px-1.5 py-0.5 rounded-full">Unverified</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    {m.contact_count>0 && <span>{m.contact_count} contacts</span>}
                    {m.deal_count>0 && <span>{m.deal_count} deals</span>}
                    {m.task_count>0 && <span>{m.task_count} tasks</span>}
                    {m.joined_at && <span>Joined {formatRelativeTime(m.joined_at)}</span>}
                  </div>
                </div>
                {/* Role selector */}
                {!isMe && (
                  <select value={m.role_slug} onChange={e=>changeRole(m.id, e.target.value)}
                    className={cn('text-xs px-2 py-1.5 rounded-lg border border-border bg-transparent focus:outline-none focus:ring-1 focus:ring-violet-500', ROLE_COLORS[m.role_slug]||ROLE_COLORS["viewer"])}>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                    {roles.map((r:any)=>(
                      <option key={r.id} value={r.slug} className="bg-card text-foreground">{r.name}</option>
                    ))}
                  </select>
                )}
                {isMe && (
                  <span className={cn('text-xs px-2 py-1 rounded-lg font-semibold capitalize', ROLE_COLORS[m.role_slug]||ROLE_COLORS["viewer"])}>
                    {m.role_name||m.role_slug}
                  </span>
                )}
                {/* Remove button */}
                {!isMe && !isAdmin && (
                  <button onClick={()=>setRemoveModal(m)}
                    className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 text-muted-foreground transition-colors shrink-0" title="Remove member">
                    <UserMinus className="w-4 h-4"/>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending invitations */}
      {invitations.length>0 && (
        <div className="admin-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-sm font-semibold">Pending Invitations ({invitations.length})</p>
          </div>
          <div className="divide-y divide-border">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
            {invitations.map((inv:any) => (
              <div key={inv.id} className="flex items-center gap-4 px-5 py-3.5">
                <Clock className="w-4 h-4 text-muted-foreground shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {inv.role_slug?.replace('_',' ')} · expires {formatDate(inv.expires_at)}
                  </p>
                </div>
                <button onClick={()=>cancelInvite(inv.id)}
                  className="text-xs text-muted-foreground hover:text-red-500 px-3 py-1.5 rounded-lg border border-border hover:border-red-300 transition-colors shrink-0">
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
