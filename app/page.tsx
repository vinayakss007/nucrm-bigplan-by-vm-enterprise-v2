'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight, Zap, Shield, Bot, Puzzle,
  Check, ChevronRight, Globe, Mail, BarChart3,
  Users, TrendingUp, Building2, Menu, X, Cpu,
  Sparkles, ArrowUpRight
} from 'lucide-react';


const features = [
  { icon: TrendingUp, title: 'Pipeline Management', desc: 'Visual drag-and-drop deals that give you full visibility into your sales process.' },
  { icon: Bot, title: 'AI Insights', desc: 'Smart scoring and predictions that help you focus on the right opportunities.' },
  { icon: Mail, title: 'Email Automation', desc: 'Sequences that convert, automatically personalized for each prospect.' },
  { icon: BarChart3, title: 'Analytics', desc: 'Real-time revenue metrics and reports that drive smarter decisions.' },
];

const integrations = [
  { icon: Globe, label: 'Web' },
  { icon: Mail, label: 'Email' },
  { icon: Shield, label: 'Security' },
  { icon: Puzzle, label: 'Plugins' },
  { icon: Zap, label: 'Zapier' },
  { icon: Users, label: 'Teams' },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: '/forever',
    features: ['Up to 2 users', '1 pipeline', '100 contacts', 'Basic reports', 'Community support'],
    cta: 'Start Free',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$79',
    period: '/mo',
    features: ['Unlimited users', 'Unlimited pipelines', 'AI assistant', 'Advanced analytics', 'SSO/SAML', 'Priority support'],
    cta: 'Start Trial',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    features: ['Everything in Pro', 'Dedicated CSM', 'Custom integrations', 'SLA guarantee', 'On-premise option'],
    cta: 'Contact Sales',
    highlight: false,
  },
];

const logos = ['Acme Corp', 'TechFlow', 'ScaleUp', 'Nexus', 'Orbit'];


export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-slate-900 overflow-x-hidden">
      {/* NAV */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">NuCRM</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-violet-600 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-violet-600 transition-colors">Pricing</a>
            <Link href="/auth/login" className="hover:text-violet-600 transition-colors">Sign In</Link>
            <Link href="/auth/signup" className="px-5 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all duration-200 font-semibold text-sm">
              Start Free
            </Link>
          </div>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2.5 rounded-xl hover:bg-slate-100 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <div className={`md:hidden overflow-hidden transition-all duration-200 ${menuOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="bg-white border-t border-slate-100 px-4 py-4 space-y-1">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-600 font-medium hover:text-violet-600 hover:bg-slate-50 rounded-xl transition-all min-h-[44px] flex items-center">Features</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-600 font-medium hover:text-violet-600 hover:bg-slate-50 rounded-xl transition-all min-h-[44px] flex items-center">Pricing</a>
            <Link href="/auth/login" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-600 font-medium hover:text-violet-600 hover:bg-slate-50 rounded-xl transition-all min-h-[44px] flex items-center">Sign In</Link>
            <Link href="/auth/signup" onClick={() => setMenuOpen(false)} className="block w-full text-center py-3 bg-slate-900 text-white rounded-xl font-semibold text-sm mt-2 min-h-[44px] flex items-center justify-center">
              Start Free
            </Link>
          </div>
        </div>
      </nav>


      {/* HERO */}
      <section className="relative pt-32 sm:pt-40 pb-24 sm:pb-32 px-4 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-20 left-[10%] w-72 h-72 bg-violet-100 rounded-full blur-3xl opacity-60" />
          <div className="absolute top-40 right-[15%] w-96 h-96 bg-indigo-100 rounded-full blur-3xl opacity-40" />
          <div className="absolute bottom-20 left-[20%] w-80 h-80 bg-cyan-100 rounded-full blur-3xl opacity-40" />
        </div>

        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-violet-50 border border-violet-100 rounded-full text-sm font-medium text-violet-700 mb-8">
            <Sparkles className="w-4 h-4" />
            <span>Now with AI-powered insights</span>
          </div>

          <h1 className="text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[1.05] text-slate-900">
            Close deals faster
          </h1>

          <p className="mt-6 sm:mt-8 text-lg sm:text-xl text-slate-500 max-w-xl mx-auto">
            The intelligent CRM that works as hard as your team. Pipeline management, AI insights, and email automation in one beautiful platform.
          </p>

          <div className="mt-10 sm:mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="w-full sm:w-auto px-8 py-4 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 hover:-translate-y-0.5 transition-all duration-200 font-semibold text-lg flex items-center justify-center gap-2.5 min-h-[44px]"
            >
              Start Free <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#features"
              className="w-full sm:w-auto px-8 py-4 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 hover:-translate-y-0.5 transition-all duration-200 font-semibold text-lg flex items-center justify-center gap-2.5 min-h-[44px] text-slate-700"
            >
              See Features
            </a>
          </div>

          {/* Social proof */}
          <div className="mt-16 sm:mt-20 flex items-center justify-center gap-8 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-400 border-2 border-white" />
                ))}
              </div>
              <span className="font-medium">500+ teams</span>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <svg key={i} className="w-4 h-4 text-amber-400 fill-current" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
              <span className="ml-1 font-medium">4.9/5</span>
            </div>
          </div>
        </div>
      </section>


      {/* FEATURES */}
      <section id="features" className="py-24 sm:py-32 px-4 bg-slate-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-violet-600 mb-3">Features</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
              Everything you need
            </h2>
            <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
              Built for modern sales teams who want to move fast and close more deals.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="group relative p-6 sm:p-8 rounded-2xl bg-white border border-slate-200 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-200"
              >
                <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center mb-5">
                  <f.icon className="w-6 h-6 text-violet-600" />
                </div>
                <h3 className="font-bold text-lg text-slate-900 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* AI-POWERED SECTION */}
      <section className="py-24 sm:py-32 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <p className="text-sm font-semibold text-violet-600 mb-3">AI-Powered</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 mb-6">
              AI that closes deals
            </h2>
            <p className="text-lg text-slate-500 mb-8 leading-relaxed">
              Our AI analyzes your pipeline to predict which deals will close, draft follow-ups, and score leads automatically.
            </p>
            <div className="space-y-4">
              {[
                'Predict which deals will close this quarter',
                'Draft follow-up emails in your tone',
                'Score leads automatically with ML',
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="w-3 h-3 text-emerald-600" />
                  </div>
                  <span className="text-slate-600">{item}</span>
                </div>
              ))}
            </div>
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 mt-8 text-violet-600 font-semibold hover:text-violet-700 transition-colors"
            >
              Try AI features <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="relative">
            <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-2xl shadow-slate-200/50 bg-gradient-to-br from-violet-50 to-indigo-50 p-8">
              <div className="bg-white rounded-xl border border-slate-100 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">AI Deal Prediction</p>
                    <p className="text-xs text-slate-500">Analyzing 24 deals</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { name: 'Enterprise License', prob: 92, color: 'bg-emerald-500' },
                    { name: 'Startup Plan', prob: 78, color: 'bg-violet-500' },
                    { name: 'Agency Tier', prob: 45, color: 'bg-amber-500' },
                  ].map((deal) => (
                    <div key={deal.name} className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-slate-700">{deal.name}</span>
                          <span className="text-sm font-bold text-slate-900">{deal.prob}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${deal.color} rounded-full`} style={{ width: `${deal.prob}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* INTEGRATIONS */}
      <section className="py-24 sm:py-32 px-4 bg-slate-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-violet-600 mb-3">Integrations</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
              Connects to everything
            </h2>
            <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
              Plug into the tools your team already uses. No code required.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto lg:mx-0">
              {integrations.map((item) => (
                <div key={item.label} className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center hover:border-violet-200 hover:shadow-md transition-all duration-200">
                    <item.icon className="w-7 h-7 text-slate-600" />
                  </div>
                  <span className="text-xs text-slate-500 font-medium">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <div className="space-y-4">
                {[
                  { name: 'Gmail', status: 'Connected', active: true },
                  { name: 'Slack', status: 'Connected', active: true },
                  { name: 'Zapier', status: 'Available', active: false },
                ].map((integration) => (
                  <div key={integration.name} className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                        <Globe className="w-5 h-5 text-slate-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{integration.name}</p>
                        <p className="text-xs text-slate-500">{integration.status}</p>
                      </div>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-medium ${integration.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {integration.active ? 'Active' : 'Connect'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* PRICING */}
      <section id="pricing" className="py-24 sm:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-violet-600 mb-3">Pricing</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
              Simple pricing
            </h2>
            <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
              Start free, upgrade when you&apos;re ready. No hidden fees.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative p-6 sm:p-8 rounded-2xl transition-all duration-200 hover:-translate-y-1 ${
                  plan.highlight
                    ? 'bg-slate-900 text-white border-2 border-slate-900 shadow-xl'
                    : 'bg-white border border-slate-200 hover:border-slate-300'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-violet-600 text-white text-xs font-bold rounded-full">
                    Popular
                  </div>
                )}
                <h3 className={`font-bold text-lg ${plan.highlight ? 'text-white' : 'text-slate-900'}`}>{plan.name}</h3>
                <div className="mt-4 mb-6">
                  <span className={`text-4xl font-extrabold ${plan.highlight ? 'text-white' : 'text-slate-900'}`}>{plan.price}</span>
                  <span className={`text-sm ml-1 ${plan.highlight ? 'text-slate-300' : 'text-slate-500'}`}>{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${plan.highlight ? 'text-violet-400' : 'text-emerald-500'}`} />
                      <span className={plan.highlight ? 'text-slate-300' : 'text-slate-600'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className={`block w-full py-3 rounded-xl text-center text-sm font-semibold transition-all duration-200 min-h-[44px] flex items-center justify-center ${
                    plan.highlight
                      ? 'bg-white text-slate-900 hover:bg-slate-100'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* CTA FOOTER */}
      <section className="py-24 sm:py-32 px-4 bg-slate-900">
        <div className="max-w-3xl mx-auto text-center text-white">
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-6">
            Ready to grow?
          </h2>
          <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-xl mx-auto">
            Join hundreds of teams closing more deals with NuCRM.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2.5 px-8 py-4 bg-white text-slate-900 rounded-2xl hover:bg-slate-100 hover:-translate-y-0.5 transition-all duration-200 font-bold text-lg shadow-xl min-h-[44px]"
          >
            Start Free <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>


      {/* FOOTER */}
      <footer className="py-12 sm:py-16 px-4 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                <Cpu className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-lg text-slate-900">NuCRM</span>
            </div>
            <div className="flex items-center gap-6 sm:gap-8 text-sm font-medium text-slate-500">
              <a href="#features" className="hover:text-violet-600 transition-colors">Features</a>
              <a href="#pricing" className="hover:text-violet-600 transition-colors">Pricing</a>
              <Link href="/auth/login" className="hover:text-violet-600 transition-colors">Sign In</Link>
              <Link href="/auth/signup" className="hover:text-violet-600 transition-colors">Start Free</Link>
            </div>
            <div className="text-sm text-slate-400">
              {new Date().getFullYear()} NuCRM. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
