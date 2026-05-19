'use client';
import { useState, useEffect } from 'react';
import {
  Settings, Save, Mail, Globe, Shield, Key, Loader2,
  CreditCard, AlertTriangle, CheckCircle, RefreshCw,
  ToggleLeft, ToggleRight, Info, Bell, Code, Users,
  Database, Zap, Lock, Eye, EyeOff, ExternalLink,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

const PLANS = ['free','starter','pro','enterprise'];
const TIMEZONES = ['UTC','America/New_York','America/Chicago','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];

export default function SuperAdminSettingsPage() {
  const [s, setS] = useState<Record<string,any>>({
    platform_name:'NuCRM', support_email:'', app_url:'',
    allow_signups:'true', require_email_verify:'true', maintenance_mode:'false',
    default_trial_days:'14', default_plan:'free', max_free_tenants:'1000',
    stripe_publishable_key:'', stripe_secret_key:'', stripe_webhook_secret:'',
    resend_api_key:'', smtp_host:'', smtp_port:'587', smtp_user:'', smtp_pass:'', smtp_from:'',
    default_timezone:'UTC', contact_score_enabled:'true',
    session_duration_days:'30', max_sessions_per_user:'10',
    backup_retention_days:'30', backup_bucket:'',
    ai_features_enabled:'false', anthropic_api_key:'',
  });
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string,boolean>>({});
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<'ok'|'fail'|null>(null);

  useEffect(() => {
    fetch('/api/superadmin/settings').then(r=>r.json()).then(d=>{
      if(d.data) setS(prev => ({...prev,...d.data}));
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);

  const set = (k: string) => (e: React.ChangeEvent<any>) => setS(p=>({...p,[k]:e.target.value}));
  const toggle = (k: string) => setS(p=>({...p,[k]: p[k]==='true'?'false':'true'}));
  const bool = (k: string) => s[k]==='true'||s[k]===true;

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/superadmin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});
    const d = await res.json();
    if(res.ok) toast.success('Settings saved to database');
    else toast.error(d.error||'Save failed');
    setSaving(false);
  };

  const sendTestEmail = async () => {
    if(!testEmail){toast.error('Enter email');return;}
    setTesting(true); setTestResult(null);
    const res = await fetch('/api/tenant/email/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:testEmail})});
    const d = await res.json();
    setTestResult(d.ok?'ok':'fail');
    if(d.ok) toast.success('Test email sent');
    else toast.error(d.error||'Email failed');
    setTesting(false);
  };

  const inp  = "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500";
  const lbl  = "block text-xs font-medium text-white/50 mb-1";
  const Tog  = ({k,label,desc}:{k:string;label:string;desc?:string}) => (
    <div className="flex items-center justify-between py-2">
      <div><p className="text-sm text-white">{label}</p>{desc&&<p className="text-xs text-white/40 mt-0.5">{desc}</p>}</div>
      <button type="button" onClick={()=>toggle(k)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',bool(k)?'bg-emerald-500/20 text-emerald-400':'bg-white/5 text-white/30')}>
        {bool(k)?<><ToggleRight className="w-4 h-4"/>ON</>:<><ToggleLeft className="w-4 h-4"/>OFF</>}
      </button>
    </div>
  );
  const Sec  = ({icon:Icon,title,desc,badge,children}:any) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-violet-400"/></div>
        <div className="flex-1"><div className="flex items-center gap-2"><p className="text-sm font-semibold text-white">{title}</p>{badge&&<span className="text-[10px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full">{badge}</span>}</div>{desc&&<p className="text-xs text-white/40">{desc}</p>}</div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
  const PwdInp = ({k,placeholder}:{k:string;placeholder:string}) => (
    <div className="relative">
      <input type={showKeys[k]?'text':'password'} value={s[k]||''} onChange={set(k)} placeholder={placeholder} className={inp+' pr-10'}/>
      <button type="button" onClick={()=>setShowKeys(p=>({...p,[k]:!p[k]}))} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
        {showKeys[k]?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
      </button>
    </div>
  );

  if(loading) return <div className="flex items-center gap-3 text-white/40 p-4"><Loader2 className="w-4 h-4 animate-spin"/>Loading settings...</div>;

  return (
    <div className="max-w-6xl space-y-5 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2"><Settings className="w-5 h-5 text-violet-400"/>Platform Settings</h1>
        <p className="text-xs text-white/40">All settings persist to the database and take effect immediately</p>
      </div>

      {bool('maintenance_mode')&&(
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0"/>
          <div><p className="text-sm font-bold text-red-400">Maintenance Mode Active</p><p className="text-xs text-red-400/60">Non-super-admin users see a maintenance page.</p></div>
        </div>
      )}

      <form onSubmit={save} className="space-y-4">
        {/* General */}
        <Sec icon={Globe} title="General" desc="Platform identity and public-facing settings">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Platform Name</label><input value={s['platform_name']||''} onChange={set('platform_name')} className={inp} placeholder="NuCRM"/></div>
            <div><label className={lbl}>Support Email</label><input type="email" value={s['support_email']||''} onChange={set('support_email')} className={inp} placeholder="support@yourcrm.com"/></div>
            <div className="col-span-2"><label className={lbl}>App URL <span className="text-white/20">(used in emails)</span></label><input value={s['app_url']||''} onChange={set('app_url')} className={inp} placeholder="https://app.yourcrm.com"/></div>
            <div><label className={lbl}>Default Timezone</label>
              <select value={s['default_timezone']||'UTC'} onChange={set('default_timezone')} className={inp}>
                {TIMEZONES.map(t=><option key={t} value={t} className="bg-slate-900">{t}</option>)}
              </select>
            </div>
          </div>
        </Sec>

        {/* Access */}
        <Sec icon={Shield} title="Access & Security" desc="Who can sign up, login requirements, session policy">
          <Tog k="allow_signups" label="Allow Public Signups" desc="Anyone can create an account at /auth/signup"/>
          <Tog k="require_email_verify" label="Require Email Verification" desc="Users must verify before accessing the app"/>
          <Tog k="maintenance_mode" label="Maintenance Mode" desc="Shows maintenance page to all non-super-admin users"/>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
            <div><label className={lbl}>Session Duration (days)</label><input type="number" value={s['session_duration_days']||'30'} onChange={set('session_duration_days')} min="1" max="365" className={inp}/></div>
            <div><label className={lbl}>Max Sessions per User</label><input type="number" value={s['max_sessions_per_user']||'10'} onChange={set('max_sessions_per_user')} min="1" max="100" className={inp}/></div>
          </div>
        </Sec>

        {/* Billing */}
        <Sec icon={CreditCard} title="Billing & Plans" desc="Defaults for new signups and trial settings" badge="Affects new accounts">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Default Plan</label>
              <select value={s['default_plan']||'free'} onChange={set('default_plan')} className={inp}>
                {PLANS.map(p=><option key={p} value={p} className="bg-slate-900 capitalize">{p}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Free Trial Duration (days)</label><input type="number" value={s['default_trial_days']||'14'} onChange={set('default_trial_days')} min="0" max="365" className={inp}/></div>
            <div><label className={lbl}>Max Free Tier Tenants (0=unlimited)</label><input type="number" value={s['max_free_tenants']||'1000'} onChange={set('max_free_tenants')} min="0" className={inp}/></div>
          </div>
          <div className="pt-3 border-t border-white/5">
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">Stripe Integration</p>
            <div className="space-y-2">
              <div><label className={lbl}>Stripe Publishable Key</label><input value={s['stripe_publishable_key']||''} onChange={set('stripe_publishable_key')} className={inp} placeholder="pk_live_..."/></div>
              <div><label className={lbl}>Stripe Secret Key</label><PwdInp k="stripe_secret_key" placeholder="sk_live_..."/></div>
              <div><label className={lbl}>Stripe Webhook Secret</label><PwdInp k="stripe_webhook_secret" placeholder="whsec_..."/></div>
            </div>
            <div className="mt-2 p-2 rounded-lg bg-white/5 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0"/>
              <p className="text-xs text-white/40">Webhook endpoint: <code className="text-violet-400">/api/webhooks/stripe</code></p>
            </div>
          </div>
        </Sec>

        {/* Email */}
        <Sec icon={Mail} title="Email Configuration" desc="Email provider for system notifications, invites, and reminders">
          <p className="text-xs text-white/40 bg-white/5 rounded-lg p-3">Configure via environment variables for security. Use test button to verify.</p>
          <div className="space-y-3">
            <div><label className={lbl}>Resend API Key <span className="text-white/20">(preferred)</span></label><PwdInp k="resend_api_key" placeholder="re_..."/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>SMTP Host <span className="text-white/20">(fallback)</span></label><input value={s['smtp_host']||''} onChange={set('smtp_host')} className={inp} placeholder="smtp.gmail.com"/></div>
              <div><label className={lbl}>SMTP Port</label><input value={s['smtp_port']||'587'} onChange={set('smtp_port')} className={inp}/></div>
              <div><label className={lbl}>SMTP Username</label><input value={s['smtp_user']||''} onChange={set('smtp_user')} className={inp} placeholder="user@gmail.com"/></div>
              <div><label className={lbl}>SMTP Password</label><PwdInp k="smtp_pass" placeholder="App password..."/></div>
              <div className="col-span-2"><label className={lbl}>From Address</label><input value={s['smtp_from']||''} onChange={set('smtp_from')} className={inp} placeholder="NuCRM <noreply@yourcrm.com>"/></div>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-white/5">
            <input type="email" value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder="test@example.com" className={inp+' flex-1'}/>
            <button type="button" onClick={sendTestEmail} disabled={testing} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-xs text-white/60 hover:text-white disabled:opacity-40 shrink-0 transition-colors">
              {testing?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<Mail className="w-3.5 h-3.5"/>}Send Test
            </button>
            {testResult&&<span className={cn('text-xs shrink-0',testResult==='ok'?'text-emerald-400':'text-red-400')}>{testResult==='ok'?'✓ Sent':'✗ Failed'}</span>}
          </div>
        </Sec>

        {/* CRM Features */}
        <Sec icon={Zap} title="CRM Features" desc="Toggle product features platform-wide">
          <Tog k="contact_score_enabled" label="Contact Scoring" desc="Automatically score contacts based on activity"/>
          <Tog k="ai_features_enabled" label="AI Features" desc="Enable AI-powered suggestions (requires Anthropic API key)"/>
          {bool('ai_features_enabled')&&(
            <div><label className={lbl}>Anthropic API Key</label><PwdInp k="anthropic_api_key" placeholder="sk-ant-..."/></div>
          )}
        </Sec>

        {/* Backups */}
        <Sec icon={Database} title="Backup Configuration" desc="Automated backup settings">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Retention (days)</label><input type="number" value={s['backup_retention_days']||'30'} onChange={set('backup_retention_days')} min="1" max="365" className={inp}/></div>
            <div><label className={lbl}>S3/R2 Bucket Name</label><input value={s['backup_bucket']||''} onChange={set('backup_bucket')} className={inp} placeholder="my-crm-backups"/></div>
          </div>
        </Sec>

        {/* Danger zone */}
        <Sec icon={AlertTriangle} title="Danger Zone" desc="Irreversible — use with caution">
          <div className="space-y-2">
            {[
              { label:'Purge Trash (30+ days old)', action:async()=>{
      const r=await fetch('/api/tenant/trash',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({purge_all:true})});
                const d=await r.json(); toast.success(`Purged ${d.purged??0} items`);
              }},
              { label:'Run Cleanup (sessions/rate limits)', action:async()=>{
                await fetch('/api/cron/cleanup',{method:'POST',headers:{'x-cron-secret':''}});
                toast.success('Cleanup triggered');
              }},
            ].map(a=>(
              <div key={a.label} className="flex items-center justify-between p-3 rounded-lg border border-red-500/15 bg-red-500/5">
                <p className="text-xs text-white/60">{a.label}</p>
                <button type="button" onClick={a.action} className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs hover:bg-red-500/10 transition-colors">{a.label.split(' ')[0]}</button>
              </div>
            ))}
          </div>
        </Sec>

        <button type="submit" disabled={saving} className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}
          {saving?'Saving...':'Save All Settings'}
        </button>
      </form>
    </div>
  );
}
