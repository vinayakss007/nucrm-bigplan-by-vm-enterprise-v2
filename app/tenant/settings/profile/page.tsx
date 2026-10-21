/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Save, User, Lock, Loader2, Eye, EyeOff, Bell, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import InlineErrorState from '@/components/shared/inline-error-state';

const TIMEZONES = ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Europe/Berlin','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];

interface UserProfile {
  full_name?: string | null;
  phone?: string | null;
  timezone?: string | null;
  avatar_url?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
}

export default function ProfileSettingsPage() {
  const [userOverride, setUserOverride] = useState<UserProfile | null>(null);
  const [profile, setProfile] = useState({ full_name:'', phone:'', timezone:'UTC', avatar_url:'' });
  const [password, setPassword] = useState({ current:'', newPass:'', confirm:'' });
  const [prefs, setPrefs] = useState({ email_task_reminders:true, email_deal_updates:true, email_mentions:true, browser_notifications:false });
  const [showPass, setShowPass] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  // #1328: load current user via TanStack Query (was raw fetch + useEffect).
  // #2872: `error` and `refetch` are bound now, because this page had only one arm
  // for two opposite questions — its `!user` early return treated a read that
  // never answered as a read still in flight, so an outage left the operator
  // staring at a skeleton forever (the skeleton never resolves: nothing retries it).
  const { data, isLoading: loading, error: meError, refetch } = useApiQuery<{ user?: UserProfile }>(['tenant', 'me'], '/api/tenant/me');
  const fetchedUser = data?.user ?? null;
  // Merge local edits saved via the profile mutation on top of the fetched user.
  const user: UserProfile | null = fetchedUser ? { ...fetchedUser, ...userOverride } : userOverride;

  // A read here has three states, not two. TanStack Query keeps `data` straight
  // through a refused revalidation (`lib/query/client.tsx`), so `meError` alone
  // cannot tell "never answered" from "the last read, refresh refused" — and the
  // second is the ordinary one, since `onSuccess` of the profile write does not
  // invalidate this key and any later mount past `staleTime` revalidates it.
  const failed = Boolean(meError) && !data;
  const stale = Boolean(meError) && Boolean(data);
  const reason = meError?.message || 'no response from the server';

  // Seed the editable form once the user is loaded.
  useEffect(() => {
    if (fetchedUser) {
      setProfile({
        full_name: fetchedUser.full_name || '',
        phone: fetchedUser.phone || '',
        timezone: fetchedUser.timezone || 'UTC',
        avatar_url: fetchedUser.avatar_url || '',
      });
    }
  }, [fetchedUser]);

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/user/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(profile)});
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      return d.user as UserProfile;
    },
    onSuccess: (u) => { toast.success('Profile updated'); setUserOverride(prev => ({ ...prev, ...u })); },
    onError: (e: Error) => toast.error(e.message || 'Failed'),
  });

  const savePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/user/password',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:password.current,new_password:password.newPass})});
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
    },
    onSuccess: () => { toast.success('Password updated'); setPassword({current:'',newPass:'',confirm:''}); },
    onError: (e: Error) => toast.error(e.message || 'Failed'),
  });

  const saving = saveProfileMutation.isPending ? 'profile' : savePasswordMutation.isPending ? 'password' : null;

  const saveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    saveProfileMutation.mutate();
  };

  const savePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if(password.newPass!==password.confirm){toast.error('Passwords do not match');return;}
    if(password.newPass.length<12||!/[A-Z]/.test(password.newPass)||!/[0-9]/.test(password.newPass)||!/[!@#$%^&*(),.?":{}|<>]/.test(password.newPass)){toast.error('Password must be 12+ chars with uppercase, number & special char');return;}
    savePasswordMutation.mutate();
  };

  // The skeleton is now only a skeleton while the read is genuinely in flight; a
  // read that never came back is an outage, and an outage says so.
  if (loading && !data) return <div className="animate-pulse space-y-4"><div className="h-8 w-40 bg-muted rounded"/><div className="admin-card h-48"/></div>;

  return (
    <div className="space-y-5 animate-fade-in">
      <h1 className="text-lg font-bold flex items-center gap-2"><User className="w-5 h-5"/>My Profile</h1>

      {/* #2872: the refused refresh sits ABOVE the identity block and the form it
          did not replace. Rule #1 is why the Save button is not disabled here:
          PATCH /api/user/profile addresses only `ctx.userId` (route.ts:82-85) — the
          record it writes is this operator's own row, not one chosen off the screen —
          and it does compare versions, but only when the body carries one
          (`expectedUpdatedAt`, route.ts:75-79) and this page sends none. So the write
          is blind to what changed since the read, and the banner has to say that out
          loud rather than silently refusing the edit the operator came for. */}
      {stale && (
        <InlineErrorState
          message={`Could not refresh your profile, so the email address and the form below are the last read: ${reason}. Save sends what this form holds back over your stored phone, timezone and avatar, and nothing on the server compares versions, because this page never sends a stamp to check against.`}
          onRetry={refetch}
        />
      )}

      {/* Profile */}
      {failed ? (
        // Nothing derived from the read renders in this arm. The editor is withheld
        // rather than shown empty: a blank name, an empty phone and the `UTC` default
        // are not this operator's details, and saving them would write them over the
        // ones the server holds — the outage must not drive the irreversible action.
        <InlineErrorState
          message={`Failed to load your profile: ${reason}. The editor is not offered here because there is nothing to put in it — an empty name, phone and timezone are not your details, and saving them would replace the ones on record.`}
          onRetry={refetch}
        />
      ) : (
      <form onSubmit={saveProfile} className="admin-card p-5 space-y-4">
        {/* The identity block is the account the read answered with; `user` is only ever null on
            the arm this form does not render on, so it is guarded rather than assumed — a missing
            email would otherwise print the verification line as a fact about no account. */}
        {user && (
        <div className="flex items-center gap-4 pb-3 border-b border-border">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xl font-bold">
            {profile.full_name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase()}
          </div>
          <div><p className="font-semibold">{profile.full_name||'Your Name'}</p><p className="text-sm text-muted-foreground">{user.email}</p>
            <p className={cn('text-xs mt-0.5', user.email_verified?'text-emerald-600':'text-amber-600')}>
              {user.email_verified ? '✓ Email verified' : '⚠ Email not verified'}
            </p>
          </div>
        </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="block text-xs font-medium text-muted-foreground mb-1">Full Name</label><input value={profile.full_name} onChange={e=>setProfile(p=>({...p,full_name:e.target.value}))} required className={inp}/></div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label><input value={profile.phone} onChange={e=>setProfile(p=>({...p,phone:e.target.value}))} className={inp} placeholder="+1 555 0100"/></div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1"><Clock className="w-3 h-3 inline mr-1"/>Timezone</label>
            <select value={profile.timezone} onChange={e=>setProfile(p=>({...p,timezone:e.target.value}))} className={inp}>
              {TIMEZONES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <button type="submit" disabled={saving==='profile'} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors">
          {saving==='profile'?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}{saving==='profile'?'Saving...':'Save Profile'}
        </button>
      </form>
      )}

      {/* Password */}
      <form onSubmit={savePassword} className="admin-card p-5 space-y-4">
        <p className="text-sm font-semibold flex items-center gap-2"><Lock className="w-4 h-4"/>Change Password</p>
        <div className="space-y-3">
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Current Password</label>
            <div className="relative">
              <input type={showPass?'text':'password'} value={password.current} onChange={e=>setPassword(p=>({...p,current:e.target.value}))} required className={inp+' pr-10'} placeholder="Current password"/>
              <button type="button" onClick={()=>setShowPass(s=>!s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showPass?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">New Password</label><input type={showPass?'text':'password'} value={password.newPass} onChange={e=>setPassword(p=>({...p,newPass:e.target.value}))} required minLength={12} className={inp} placeholder="12+ chars, uppercase, number, special"/></div>
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Confirm</label><input type={showPass?'text':'password'} value={password.confirm} onChange={e=>setPassword(p=>({...p,confirm:e.target.value}))} required className={inp} placeholder="Repeat"/></div>
          </div>
        </div>
        <button type="submit" disabled={saving==='password'} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors">
          {saving==='password'?<Loader2 className="w-4 h-4 animate-spin"/>:<Lock className="w-4 h-4"/>}{saving==='password'?'Updating...':'Update Password'}
        </button>
      </form>

      {/* Notification preferences */}
      <div className="admin-card p-5 space-y-3">
        <p className="text-sm font-semibold flex items-center gap-2"><Bell className="w-4 h-4"/>Notification Preferences</p>
        {[
          {k:'email_task_reminders',label:'Task reminders by email',desc:'Daily email for overdue tasks'},
          {k:'email_deal_updates',label:'Deal stage changes by email',desc:'When a deal moves to a new stage'},
          {k:'email_mentions',label:'Email on @mentions',desc:'When someone mentions you in a note'},
        ].map(({k,label,desc})=>(
          <div key={k} className="flex items-center justify-between py-1.5">
            <div><p className="text-sm">{label}</p><p className="text-xs text-muted-foreground">{desc}</p></div>
            <button type="button" onClick={()=>setPrefs(p=>({...p,[k]:!p[k as keyof typeof p]}))}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',prefs[k as keyof typeof prefs]?'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400':'bg-muted text-muted-foreground')}>
              {prefs[k as keyof typeof prefs]?'On':'Off'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
