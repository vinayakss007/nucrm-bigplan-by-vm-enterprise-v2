'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Eye, EyeOff, Mail, Lock, User, Building2,
  Cpu, CheckCircle, ArrowRight, Shield, Rocket, Target
} from 'lucide-react';
import toast from 'react-hot-toast';


function getPasswordStrength(password: string): { level: 'weak' | 'medium' | 'strong'; score: number } {
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 14) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;

  if (score <= 2) return { level: 'weak', score };
  if (score <= 3) return { level: 'medium', score };
  return { level: 'strong', score };
}

const strengthColors = {
  weak: 'bg-red-500',
  medium: 'bg-amber-500',
  strong: 'bg-emerald-500',
};

const strengthLabels = {
  weak: 'Weak',
  medium: 'Medium',
  strong: 'Strong',
};


export default function SignupPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const passwordStrength = getPasswordStrength(password);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!agreedToTerms) {
      setError('Please agree to the Terms of Service');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          full_name: name,
          workspace_name: workspaceName,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Signup failed');
        setLoading(false);
        return;
      }
      toast.success('Workspace created! Welcome to NuCRM.');
      setTimeout(() => router.push('/tenant/dashboard'), 1500);
    } catch {
      setError('Connection error. Please try again.');
      setLoading(false);
    }
  }


  return (
    <div className="min-h-screen flex">
      {/* Left branding panel - hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600 via-indigo-600 to-violet-800" />
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-20 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-indigo-300/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-violet-400/5 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <div>
            <div className="flex items-center gap-3 mb-16">
              <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <span className="text-2xl font-bold text-white">NuCRM</span>
            </div>
            <h1 className="text-3xl xl:text-4xl font-extrabold text-white leading-tight mb-4">
              Start closing deals<br />faster today
            </h1>
            <p className="text-lg text-violet-100/80 leading-relaxed max-w-md">
              Set up your workspace in under 2 minutes. No credit card required.
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: Rocket, text: 'Get started in under 2 minutes' },
              { icon: Target, text: 'Free plan with no time limit' },
              { icon: Shield, text: 'Enterprise-grade from day one' },
            ].map((item) => (
              <div key={item.text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur-sm flex items-center justify-center">
                  <item.icon className="w-4 h-4 text-violet-200" />
                </div>
                <span className="text-sm font-medium text-violet-100">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* Right form panel */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-8 bg-white dark:bg-slate-950 relative overflow-y-auto">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50/30 via-transparent to-indigo-50/30 dark:from-violet-950/10 dark:via-transparent dark:to-indigo-950/10 lg:hidden" />

        <div className="w-full max-w-md relative z-10 py-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <span className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
            </div>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-xl shadow-slate-200/50 dark:shadow-none p-8 sm:p-10">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Create your workspace</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Free forever. No credit card required.</p>
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-red-600 dark:text-red-400 text-xs font-bold">!</span>
                </div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}


            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Workspace name */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Workspace name</label>
                <div className={`relative rounded-xl transition-all duration-300 ${focusedField === 'workspace' ? 'ring-2 ring-violet-500/50 shadow-lg shadow-violet-500/10' : ''}`}>
                  <div className={`absolute inset-0 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 opacity-0 transition-opacity duration-300 ${focusedField === 'workspace' ? 'opacity-100' : ''}`} style={{ padding: '1px' }}>
                    <div className="w-full h-full rounded-xl bg-white dark:bg-slate-900" />
                  </div>
                  <div className="relative flex items-center">
                    <Building2 className="absolute left-4 w-4 h-4 text-slate-400" />
                    <input
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      required
                      placeholder="Acme Corp"
                      onFocus={() => setFocusedField('workspace')}
                      onBlur={() => setFocusedField(null)}
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:outline-none focus:border-violet-500 dark:focus:border-violet-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors min-h-[44px]"
                    />
                  </div>
                </div>
              </div>

              {/* Full name */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Full name</label>
                <div className={`relative rounded-xl transition-all duration-300 ${focusedField === 'name' ? 'ring-2 ring-violet-500/50 shadow-lg shadow-violet-500/10' : ''}`}>
                  <div className={`absolute inset-0 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 opacity-0 transition-opacity duration-300 ${focusedField === 'name' ? 'opacity-100' : ''}`} style={{ padding: '1px' }}>
                    <div className="w-full h-full rounded-xl bg-white dark:bg-slate-900" />
                  </div>
                  <div className="relative flex items-center">
                    <User className="absolute left-4 w-4 h-4 text-slate-400" />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder="Jane Smith"
                      onFocus={() => setFocusedField('name')}
                      onBlur={() => setFocusedField(null)}
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:outline-none focus:border-violet-500 dark:focus:border-violet-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors min-h-[44px]"
                    />
                  </div>
                </div>
              </div>


              {/* Email */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Work email</label>
                <div className={`relative rounded-xl transition-all duration-300 ${focusedField === 'email' ? 'ring-2 ring-violet-500/50 shadow-lg shadow-violet-500/10' : ''}`}>
                  <div className={`absolute inset-0 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 opacity-0 transition-opacity duration-300 ${focusedField === 'email' ? 'opacity-100' : ''}`} style={{ padding: '1px' }}>
                    <div className="w-full h-full rounded-xl bg-white dark:bg-slate-900" />
                  </div>
                  <div className="relative flex items-center">
                    <Mail className="absolute left-4 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="jane@company.com"
                      onFocus={() => setFocusedField('email')}
                      onBlur={() => setFocusedField(null)}
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:outline-none focus:border-violet-500 dark:focus:border-violet-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors min-h-[44px]"
                    />
                  </div>
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Password</label>
                <div className={`relative rounded-xl transition-all duration-300 ${focusedField === 'password' ? 'ring-2 ring-violet-500/50 shadow-lg shadow-violet-500/10' : ''}`}>
                  <div className={`absolute inset-0 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 opacity-0 transition-opacity duration-300 ${focusedField === 'password' ? 'opacity-100' : ''}`} style={{ padding: '1px' }}>
                    <div className="w-full h-full rounded-xl bg-white dark:bg-slate-900" />
                  </div>
                  <div className="relative flex items-center">
                    <Lock className="absolute left-4 w-4 h-4 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={12}
                      placeholder="Create a strong password"
                      onFocus={() => setFocusedField('password')}
                      onBlur={() => setFocusedField(null)}
                      className="w-full pl-11 pr-12 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:outline-none focus:border-violet-500 dark:focus:border-violet-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors min-h-[44px]"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>


                {/* Password strength indicator */}
                {password.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Password strength</span>
                      <span className={`text-xs font-bold ${
                        passwordStrength.level === 'weak' ? 'text-red-500' :
                        passwordStrength.level === 'medium' ? 'text-amber-500' : 'text-emerald-500'
                      }`}>
                        {strengthLabels[passwordStrength.level]}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {[1, 2, 3].map((bar) => (
                        <div
                          key={bar}
                          className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                            bar <= (passwordStrength.level === 'weak' ? 1 : passwordStrength.level === 'medium' ? 2 : 3)
                              ? strengthColors[passwordStrength.level]
                              : 'bg-slate-200 dark:bg-slate-700'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Terms checkbox */}
              <div className="flex items-start gap-3 pt-1">
                <div className="relative flex items-center justify-center min-w-[20px] min-h-[20px] mt-0.5">
                  <input
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="w-5 h-5 rounded-md border-2 border-slate-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500 focus:ring-offset-0 cursor-pointer transition-colors"
                  />
                </div>
                <label className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed cursor-pointer" onClick={() => setAgreedToTerms(!agreedToTerms)}>
                  I agree to the{' '}
                  <span className="text-violet-600 dark:text-violet-400 font-medium hover:underline">Terms of Service</span>
                  {' '}and{' '}
                  <span className="text-violet-600 dark:text-violet-400 font-medium hover:underline">Privacy Policy</span>
                </label>
              </div>


              {/* Submit button */}
              <button
                type="submit"
                disabled={loading || !agreedToTerms}
                className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-bold hover:shadow-lg hover:shadow-violet-500/25 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none transition-all duration-300 flex items-center justify-center gap-2.5 min-h-[44px]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating workspace...
                  </>
                ) : (
                  <>
                    Create workspace
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
              <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                Already have an account?{' '}
                <Link href="/auth/login" className="text-violet-600 dark:text-violet-400 font-semibold hover:text-violet-700 dark:hover:text-violet-300 transition-colors">
                  Sign in
                </Link>
              </p>
            </div>
          </div>

          {/* Trust indicators */}
          <div className="mt-8 flex items-center justify-center gap-6 text-xs text-slate-400 dark:text-slate-500">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              <span>256-bit encryption</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>No credit card required</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
