'use client';
import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Building2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

function SignupForm() {
  const [step, setStep] = useState<'account'|'workspace'>('account');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: name, workspace_name: workspaceName }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Signup failed'); setLoading(false); return; }
    toast.success('Workspace created! Welcome to NuCRM.');
    router.push('/tenant/dashboard');
    router.refresh();
  };

  const inp = "w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-muted-foreground";

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25"><Zap className="w-5 h-5 text-white" strokeWidth={2.5} /></div>
            <span className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
          </div>
          <div className="flex items-center justify-center gap-2 mt-3">
            {['Your Account','Workspace'].map((s,i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${(step==='account'&&i===0)||(step==='workspace'&&i===1)?'text-violet-600':'text-muted-foreground'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${(step==='account'&&i===0)||(step==='workspace'&&i===1)?'bg-violet-600 text-white':i<(step==='workspace'?1:0)?'bg-emerald-500 text-white':'bg-muted text-muted-foreground'}`}>{i+1}</div>
                  {s}
                </div>
                {i===0&&<div className="w-8 h-px bg-border"/>}
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
          {step==='account'?(
            <>
              <h1 className="text-xl font-bold mb-5">Create your account</h1>
              <form onSubmit={e=>{e.preventDefault();if(password.length<12||!/[A-Z]/.test(password)||!/[0-9]/.test(password)||!/[!@#$%^&*(),.?":{}|<>]/.test(password)){toast.error('Password must be 12+ chars with uppercase, number & special char');return;}setStep('workspace');}} className="space-y-4">
                <div><label className="block text-sm font-medium mb-1.5">Full Name</label><input value={name} onChange={e=>setName(e.target.value)} required placeholder="Jane Smith" className={inp}/></div>
                <div><label className="block text-sm font-medium mb-1.5">Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="jane@company.com" className={inp}/></div>
                <div><label className="block text-sm font-medium mb-1.5">Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} placeholder="12+ chars, uppercase, number, special" className={inp}/></div>
                <button type="submit" className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-lg shadow-violet-500/25">Continue →</button>
              </form>
            </>
          ):(
            <>
              <h1 className="text-xl font-bold mb-5">Name your workspace</h1>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Workspace / Company Name</label>
                  <input value={workspaceName} onChange={e=>setWorkspaceName(e.target.value)} required placeholder="Acme Corp" className={inp}/>
                </div>
                <div className="bg-violet-50 dark:bg-violet-950/30 rounded-xl p-4 text-xs text-violet-600 dark:text-violet-400 space-y-1">
                  <p className="font-semibold">Free Plan includes:</p>
                  <div className="grid grid-cols-2 gap-1">{['1 user','500 contacts','100 deals','2 automations','14-day Pro trial'].map(f=><div key={f}>✓ {f}</div>)}</div>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={()=>setStep('account')} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Back</button>
                  <button type="submit" disabled={loading||!workspaceName} className="flex-1 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                    {loading&&<Loader2 className="w-4 h-4 animate-spin"/>}
                    {loading?'Creating...':'Create Workspace'}
                  </button>
                </div>
              </form>
            </>
          )}
          <p className="text-center text-sm text-muted-foreground mt-4">Already have an account? <Link href="/auth/login" className="text-violet-600 font-medium hover:underline">Sign in</Link></p>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-600" /></div>}>
      <SignupForm />
    </Suspense>
  );
}
