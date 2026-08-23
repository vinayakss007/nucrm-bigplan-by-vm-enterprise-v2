/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Eye, EyeOff, Mail, Lock, Shield, BarChart3,
  Users, Cpu, CheckCircle, ArrowRight, X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFormValidation } from '@/lib/hooks/use-form-validation';

const validationRules = {
  email: {
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  password: {
    required: true,
    minLength: 1,
  },
};

export default function LoginForm() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const searchParams = useSearchParams();
  const { errors, touched, validate, touch, validateAll } = useFormValidation(validationRules);

  useEffect(() => {
    const errMsg = searchParams.get('error');
    if (errMsg) setError(errMsg);
  }, [searchParams]);

  useEffect(() => {
    const saved = localStorage.getItem('nucrm_remember');
    if (saved) {
      try {
        const { email: savedEmail } = JSON.parse(saved);
        if (savedEmail) { setEmail(savedEmail); setRememberMe(true); }
      } catch { /* ignore corrupted */ }
    }
  }, []);

  async function handleLogin() {
    const values = { email, password };
    if (!validateAll(values)) {
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, remember_me: rememberMe }),
      });

      const data = await res.json();
      if (res.ok) {
        if (rememberMe) {
          localStorage.setItem('nucrm_remember', JSON.stringify({ email }));
        } else {
          localStorage.removeItem('nucrm_remember');
        }
        toast.success('Welcome back!');
        setLoading(false);
        setTimeout(() => {
          window.location.href = '/tenant/dashboard';
        }, 800);
      } else {
        setError(data.error || 'Invalid email or password');
        setLoading(false);
      }
    } catch {
      setError('Connection error. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
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
              Welcome back to your<br />revenue command center
            </h1>
            <p className="text-lg text-slate-500 leading-relaxed max-w-md">
              Pick up right where you left off. Your pipeline, deals, and team insights are waiting.
            </p>
          </div>
          <div className="space-y-4">
            {[
              { icon: BarChart3, text: 'Real-time pipeline analytics' },
              { icon: Shield, text: 'Enterprise-grade security' },
              { icon: Users, text: 'Team collaboration built in' },
            ].map((item) => (
              <div key={item.text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                  <item.icon className="w-4 h-4 text-violet-600" />
                </div>
                <span className="text-sm font-medium text-slate-600">{item.text}</span>
              </div>
            ))}
          </div>
          <div className="mt-12 p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-indigo-400" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Sarah Chen</p>
                <p className="text-xs text-slate-500">VP of Sales, Acme Corp</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 italic">
              &quot;NuCRM helped us increase our close rate by 40% in just 3 months. The AI insights are game-changing.&quot;
            </p>
          </div>
        </div>
      </div>
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-8 bg-white relative">
        <div className="w-full max-w-md relative z-10">
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
              <h1 className="text-2xl font-extrabold text-slate-900">Welcome back</h1>
              <p className="text-sm text-slate-500 mt-2">Sign in to your workspace to continue</p>
            </div>
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <X className="w-3 h-3 text-red-600" />
                </div>
                <p className="text-sm font-medium text-red-700">{error}</p>
              </div>
            )}
            <form noValidate onSubmit={(e) => e.preventDefault()} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => touch('email') && validate('email', email)}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? 'email-error' : undefined}
                    className={`w-full pl-11 pr-4 py-3.5 rounded-xl border bg-white text-sm font-medium focus:outline-none focus:ring-2 placeholder:text-slate-400 transition-all min-h-[44px] ${
                      errors.email && touched.email
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                        : 'border-slate-200 focus:border-violet-500 focus:ring-violet-500/20'
                    }`}
                  />
                </div>
                {errors.email && touched.email && (
                  <p id="email-error" className="mt-1.5 text-xs text-red-600" role="alert">{errors.email}</p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-slate-700">Password</label>
                  <Link href="/auth/forgot-password" className="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => touch('password') && validate('password', password)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    aria-invalid={!!errors.password}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    className={`w-full pl-11 pr-14 py-3.5 rounded-xl border bg-white text-sm font-medium focus:outline-none focus:ring-2 placeholder:text-slate-400 transition-all min-h-[44px] ${
                      errors.password && touched.password
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                        : 'border-slate-200 focus:border-violet-500 focus:ring-violet-500/20'
                    }`}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all flex items-center justify-center"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && touched.password && (
                  <p id="password-error" className="mt-1.5 text-xs text-red-600" role="alert">{errors.password}</p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="remember_me"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500 dark:bg-slate-800"
                  />
                  <span className="text-sm text-slate-600 dark:text-slate-400">Remember me</span>
                </label>
              </div>
              <button
                type="button"
                onClick={handleLogin}
                disabled={loading}
                className="w-full py-3.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-slate-900 transition-all duration-200 flex items-center justify-center gap-2.5 min-h-[44px]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
            <div className="mt-8 pt-6 border-t border-slate-100">
              <p className="text-center text-sm text-slate-500">
                Don&apos;t have an account?{' '}
                <Link href="/auth/signup" className="text-violet-600 font-semibold hover:text-violet-700 transition-colors">
                  Sign up free
                </Link>
              </p>
            </div>
          </div>
          <div className="mt-8 flex items-center justify-center gap-6 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              <span>256-bit encryption</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>SOC 2 compliant</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
