'use client';
import { useState, useEffect } from 'react';
import { Save, User, Lock, Loader2, Eye, EyeOff, Bell, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

const TIMEZONES = ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Europe/Berlin','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];

export default function ProfileSettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState({ full_name:'', phone:'', timezone:'UTC', avatar_url:'' });
  const [password, setPassword] = useState({ current:'', newPass:'', confirm:'' });
  const [prefs, setPrefs] = useState({ email_task_reminders:true, email_deal_updates:true, email_mentions:true, browser_notifications:false });
  const [saving, setSaving] = useState<string|null>(null);
  const [showPass, setShowPass] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  useEffect(() => {
  let ignore = false;
    fetch('/api/tenant/me').then(r=>r.json()).then(d=>{ if (ignore) return;
      if(d.user){ setUser(d.user); setProfile({ full_name:d.user.full_name||'', phone:d.user.phone||'', timezone:d.user.timezone||'UTC', avatar_url:d.user.avatar_url||'' }); }
    });
    return () => { ignore = true; };
}, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving('profile');
    const res = await fetch('/api/user/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(profile)});
    const d = await res.json();
    if(res.ok){toast.success('Profile updated');setUser((u:any)=>({...u,...d.user}));}
    else toast.error(d.error||'Failed');
    setSaving(null);
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if(password.newPass!==password.confirm){toast.error('Passwords do not match');return;}
    if(password.newPass.length<12||!/[A-Z]/.test(password.newPass)||!/[0-9]/.test(password.newPass)||!/[!@#$%^&*(),.?":{}|<>]/.test(password.newPass)){toast.error('Password must be 12+ chars with uppercase, number & special char');return;}
    setSaving('password');
    const res = await fetch('/api/user/password',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:password.current,new_password:password.newPass})});
    const d = await res.json();
    if(res.ok){toast.success('Password updated');setPassword({current:'',newPass:'',confirm:''});}
    else toast.error(d.error||'Failed');
    setSaving(null);
  };

  if(!user) return <div className="animate-pulse space-y-4"><div className="h-8 w-40 bg-muted rounded"/><div className="admin-card h-48"/></div>;

  return (
    <div className="space-y-5 animate-fade-in">
      <h1 className="text-lg font-bold flex items-center gap-2"><User className="w-5 h-5"/>My Profile</h1>

      {/* Profile */}
      <form onSubmit={saveProfile} className="admin-card p-5 space-y-4">
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
