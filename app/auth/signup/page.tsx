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
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-slate-50">
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <div>
            <div className="flex items-center gap-3 mb-16">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <span className="text-2xl font-bold text-slate-900">NuCRM</span>
            </div>
            <h1 className="text-3xl xl:text-4xl font-extrabold text-slate-900 leading-tight mb-4">
              Start closing deals<br />faster today
            </h1>
            <p className="text-lg text-slate-500 leading-relaxed max-w-md">
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
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                  <item.icon className="w-4 h-4 text-violet-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">{item.text}</span>
              </div>
            ))}
          </div>

          <div className="mt-12 grid grid-cols-3 gap-4">
            {[
              { value: '500+', label: 'Teams' },
              { value: '10K+', label: 'Deals closed' },
              { value: '99.9%', label: 'Uptime' },
            ].map((stat) => (
              <div key={stat.label} className="text-center p-4 bg-white rounded-xl border border-slate-200">
                <p className="text-2xl font-extrabold text-slate-900">{stat.value}</p>
                <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* Right form panel */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-8 bg-white relative overflow-y-auto">
        <div className="w-full max-w-md relative z-10 py-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <span className="text-2xl font-bold text-slate-900">NuCRM</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 p-8 sm:p-10">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold text-slate-900">Create your workspace</h1>
              <p className="text-sm text-slate-500 mt-2">Free forever. No credit card required.</p>
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-red-600 text-xs font-bold">!</span>
                </div>
                <p className="text-sm font-medium text-red-700">{error}</p>
              </div>
            )}


            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Workspace name */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Workspace name</label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    required
                    placeholder="Acme Corp"
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 placeholder:text-slate-400 transition-all min-h-[44px]"
                  />
                </div>
              </div>

              {/* Full name */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Full name</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Jane Smith"
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 placeholder:text-slate-400 transition-all min-h-[44px]"
                  />
                </div>
              </div>


              {/* Email */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Work email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="jane@company.com"
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 placeholder:text-slate-400 transition-all min-h-[44px]"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={12}
                    placeholder="Create a strong password"
                    className="w-full pl-11 pr-12 py-3.5 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 placeholder:text-slate-400 transition-all min-h-[44px]"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>


                {/* Password strength indicator */}
                {password.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-slate-500">Password strength</span>
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
                              : 'bg-slate-200'
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
                    className="w-5 h-5 rounded-md border-2 border-slate-300 text-violet-600 focus:ring-violet-500 focus:ring-offset-0 cursor-pointer transition-colors"
                  />
                </div>
                <label className="text-sm text-slate-600 leading-relaxed cursor-pointer" onClick={() => setAgreedToTerms(!agreedToTerms)}>
                  I agree to the{' '}
                  <span className="text-violet-600 font-medium hover:underline">Terms of Service</span>
                  {' '}and{' '}
                  <span className="text-violet-600 font-medium hover:underline">Privacy Policy</span>
                </label>
              </div>


              {/* Submit button */}
              <button
                type="submit"
                disabled={loading || !agreedToTerms}
                className="w-full py-3.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-slate-900 transition-all duration-200 flex items-center justify-center gap-2.5 min-h-[44px]"
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

            <div className="mt-8 pt-6 border-t border-slate-100">
              <p className="text-center text-sm text-slate-500">
                Already have an account?{' '}
                <Link href="/auth/login" className="text-violet-600 font-semibold hover:text-violet-700 transition-colors">
                  Sign in
                </Link>
              </p>
            </div>
          </div>

          {/* Trust indicators */}
          <div className="mt-8 flex items-center justify-center gap-6 text-xs text-slate-400">
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
