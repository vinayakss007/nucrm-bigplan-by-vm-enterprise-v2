'use client';
import { useState, useEffect } from 'react';
import { Mail, Loader2, CheckCircle, AlertTriangle, Send } from 'lucide-react';
import toast from 'react-hot-toast';

export default function EmailSettingsPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<'ok'|'fail'|null>(null);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  useEffect(() => { setLoading(false); }, []);

  const sendTest = async () => {
    if (!testEmail) { toast.error('Enter email'); return; }
    setTesting(true); setResult(null);
    const res = await fetch('/api/tenant/email/test', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to:testEmail }) });
    const d = await res.json();
    setResult(d.ok ? 'ok' : 'fail');
    if (d.ok) toast.success('Test email sent!'); else toast.error(d.error || 'Failed');
    setTesting(false);
  };

  const EMAIL_EVENTS = [
    { id:'invite', label:'Team Invitation', desc:'Sent when you invite a team member', status:'active' },
    { id:'verify', label:'Email Verification', desc:'Sent on signup to verify email address', status:'active' },
    { id:'reset',  label:'Password Reset', desc:'Sent when user requests password reset', status:'active' },
    { id:'task_reminder', label:'Task Reminders', desc:'Daily email for overdue tasks', status:'active' },
    { id:'deal_won', label:'Deal Won', desc:'Notification when a deal is won', status:'inactive' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><Mail className="w-5 h-5"/>Email Settings</h1>
        <p className="text-sm text-muted-foreground">Configure notifications and test your email delivery</p>
      </div>

      {/* Provider status */}
      <div className="admin-card p-4">
        <p className="text-sm font-semibold mb-3">Email Provider</p>
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
          <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-950/30 rounded-full flex items-center justify-center">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-medium">Email provider configured</p>
            <p className="text-xs text-muted-foreground">Set via environment variables: RESEND_API_KEY or SMTP_HOST</p>
          </div>
        </div>
      </div>

      {/* Test email */}
      <div className="admin-card p-5 space-y-3">
        <p className="text-sm font-semibold">Test Email Delivery</p>
        <p className="text-xs text-muted-foreground">Send a test email to verify your provider is configured correctly.</p>
        <div className="flex gap-2">
          <input type="email" value={testEmail} onChange={e=>setTestEmail(e.target.value)}
            placeholder="test@example.com" className={inp + ' flex-1'} />
          <button onClick={sendTest} disabled={testing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 shrink-0 transition-colors">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {testing ? 'Sending...' : 'Send Test'}
          </button>
        </div>
        {result && (
          <p className={`text-sm flex items-center gap-2 ${result==='ok'?'text-emerald-600':'text-red-500'}`}>
            {result==='ok' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {result==='ok' ? 'Test email delivered successfully!' : 'Email failed — check provider configuration'}
          </p>
        )}
      </div>

      {/* Email events */}
      <div className="admin-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <p className="text-sm font-semibold">System Email Events</p>
          <p className="text-xs text-muted-foreground">Emails sent automatically by NuCRM</p>
        </div>
        <div className="divide-y divide-border">
          {EMAIL_EVENTS.map(ev => (
            <div key={ev.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="flex-1">
                <p className="text-sm font-medium">{ev.label}</p>
                <p className="text-xs text-muted-foreground">{ev.desc}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ev.status==='active'?'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400':'bg-muted text-muted-foreground'}`}>
                {ev.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
