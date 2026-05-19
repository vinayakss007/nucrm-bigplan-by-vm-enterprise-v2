'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Shield, Zap, Users, TrendingUp, CheckCircle, BarChart3, Mail, Phone,
  Calendar, Lock, Database, Cloud, Headphones, ArrowRight, Star,
  Building2, PieChart, MessageSquare, FileText, Globe, Cpu, Activity,
  Target, Layers, GitBranch, Bot, LineChart, Wallet, Megaphone,
  Settings, Eye, Smartphone, Workflow, Award, Rocket, ChevronDown,
  Menu, X
} from 'lucide-react';

const features = [
  { icon: Target, title: 'Lead & Contact Management', desc: 'Track every lead from first touch to closed deal. Rich profiles, activity timelines, smart search, and deduplication.' },
  { icon: GitBranch, title: 'Sales Pipelines', desc: 'Visual Kanban boards with drag-and-drop deal management. Create unlimited custom pipelines per team.' },
  { icon: Building2, title: 'Company Management', desc: 'Organize contacts by company, track relationships, and manage account hierarchies.' },
  { icon: Wallet, title: 'Deal Tracking', desc: 'Forecast revenue, track deal stages, manage products and pricing with full quote generation.' },
  { icon: Workflow, title: 'Task & Activity Management', desc: 'Schedule calls, meetings, and follow-ups. Never miss a step with smart reminders.' },
  { icon: Mail, title: 'Email Sequences', desc: 'Automated multi-step email campaigns with tracking, open/click analytics, and A/B testing.' },
  { icon: Megaphone, title: 'Marketing Automation', desc: 'Capture leads via forms, score them automatically, and route to the right sales rep.' },
  { icon: Bot, title: 'AI Assistant', desc: 'AI-powered insights, email drafting, contact scoring, and churn predictions.' },
  { icon: BarChart3, title: 'Advanced Reporting', desc: 'Custom dashboards, saved reports, revenue projections, and pipeline health metrics.' },
  { icon: Layers, title: 'Custom Fields & Objects', desc: 'Extend any entity with custom fields, tags, and relationships. Adapt NuCRM to your workflow.' },
  { icon: Shield, title: 'Enterprise Security', desc: 'Role-based access control, data isolation, audit logs, 2FA, SSO/SAML support, and field-level permissions.' },
  { icon: Cloud, title: 'Multi-Tenant SaaS', desc: 'Built for scale — isolate tenant data, manage billing, usage limits, and plan tiers automatically.' },
  { icon: Globe, title: 'Public Lead Forms', desc: 'Embeddable lead capture forms for your website. Auto-create contacts and trigger workflows.' },
  { icon: MessageSquare, title: 'Conversation Intelligence', desc: 'Call notes, recordings, transcription, sentiment analysis, and keyword tracking.' },
  { icon: FileText, title: 'Notes & Documents', desc: 'Rich notes, file attachments, and document management linked to any contact or deal.' },
  { icon: Settings, title: 'Integrations & Webhooks', desc: 'Connect with external tools via webhooks, API keys, and pre-built integration templates.' },
];

const stats = [
  { value: '30%', label: 'Faster Close Rate', icon: Rocket },
  { value: '5x', label: 'Pipeline Visibility', icon: Eye },
  { value: '99.9%', label: 'Uptime SLA', icon: Shield },
  { value: '10K+', label: 'Deals Managed Daily', icon: TrendingUp },
];

const plans = [
  { name: 'Free', price: '$0', period: '/forever', desc: 'For individuals trying out NuCRM', features: ['1 user', '1 pipeline', '100 contacts', 'Community support', 'Basic reports'], cta: 'Get Started', highlight: false },
  { name: 'Basic', price: '$19', period: '/user/mo', desc: 'For small teams just starting', features: ['Up to 5 users', '3 pipelines', '5K contacts', 'Email support', 'Basic reports', 'Custom fields'], cta: 'Start Trial', highlight: false },
  { name: 'Starter', price: '$49', period: '/user/mo', desc: 'For growing sales teams', features: ['Up to 25 users', 'Unlimited pipelines', '50K contacts', 'Email sequences', 'Advanced reports', 'API access', 'Priority support'], cta: 'Get Started', highlight: true },
  { name: 'Enterprise', price: 'Custom', period: '', desc: 'For large organizations', features: ['Unlimited everything', 'SSO/SAML', 'Dedicated CSM', 'Custom integrations', 'SLA guarantee', 'On-premise option', 'Audit logs'], cta: 'Contact Sales', highlight: false },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-x-hidden">
      {/* ── NAV ── */}
      <nav className="fixed top-0 w-full z-50 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <Cpu className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <span className="text-lg sm:text-xl font-bold tracking-tight dark:text-white">NuCRM</span>
            <span className="text-[10px] sm:text-xs text-slate-400 ml-1 hidden sm:inline">by <span className="text-violet-600 font-semibold dark:text-violet-400">abetworks.in</span></span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
            <a href="#features" className="hover:text-violet-600 dark:hover:text-violet-400 transition">Features</a>
            <a href="#pricing" className="hover:text-violet-600 dark:hover:text-violet-400 transition">Pricing</a>
            <Link href="/auth/signup" className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition font-medium text-sm">
              Get Started
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2 rounded-lg hover:bg-slate-100 transition" aria-label="Toggle menu">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="md:hidden bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-4 py-4 space-y-3">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block py-2 text-slate-700 dark:text-slate-300 font-medium hover:text-violet-600 dark:hover:text-violet-400 transition">Features</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="block py-2 text-slate-700 dark:text-slate-300 font-medium hover:text-violet-600 dark:hover:text-violet-400 transition">Pricing</a>
            <Link href="/auth/signup" onClick={() => setMenuOpen(false)} className="block w-full text-center py-2.5 bg-violet-600 text-white rounded-lg font-medium text-sm">
              Get Started
            </Link>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="pt-24 sm:pt-32 pb-12 sm:pb-20 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-blue-50 dark:from-violet-950/30 dark:via-slate-950 dark:to-blue-950/30 -z-10" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-violet-200/30 dark:bg-violet-600/10 rounded-full blur-3xl -z-10" />
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-[10px] sm:text-xs font-semibold mb-4 sm:mb-6">
            <Zap className="w-3 h-3" /> Built for modern sales teams
          </div>
          <h1 className="text-3xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.1] dark:text-white">
            The CRM that <span className="bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-transparent">moves deals</span>
            <br className="hidden sm:block" />forward
          </h1>
          <p className="mt-4 sm:mt-6 text-base sm:text-lg lg:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed px-2">
            NuCRM by <strong className="text-slate-700 dark:text-slate-300">abetworks.in</strong> gives your team everything — lead management,
            pipelines, email sequences, AI insights, and enterprise security.
          </p>
          <div className="mt-6 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 px-4">
            <Link href="/auth/signup" className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition font-semibold text-base sm:text-lg flex items-center justify-center gap-2 shadow-lg shadow-violet-200">
              Start Free Trial <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </Link>
            <a href="#features" className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 border border-slate-300 rounded-xl hover:border-violet-400 transition font-semibold text-base sm:text-lg flex items-center justify-center gap-2">
              See Features <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
            </a>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="py-10 sm:py-16 border-y border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <s.icon className="w-5 h-5 sm:w-6 sm:h-6 mx-auto mb-1.5 sm:mb-2 text-violet-500" />
              <div className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 dark:text-white">{s.value}</div>
              <div className="text-[11px] sm:text-sm text-slate-600 dark:text-slate-400 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES GRID ── */}
      <section id="features" className="py-16 sm:py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight dark:text-white">
              Everything your <span className="text-violet-600 dark:text-violet-400">sales team</span> needs
            </h2>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
              From first contact to closed deal — NuCRM covers every step of your sales process.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {features.map((f) => (
              <div key={f.title} className="group p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-violet-300 dark:hover:border-violet-600 hover:shadow-lg hover:shadow-violet-50 dark:hover:shadow-violet-900/20 transition-all duration-300 bg-white dark:bg-slate-900">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mb-3 sm:mb-4 group-hover:bg-violet-600 transition-colors">
                  <f.icon className="w-4 h-4 sm:w-5 sm:h-5 text-violet-600 dark:text-violet-400 group-hover:text-white transition-colors" />
                </div>
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white mb-1.5 sm:mb-2">{f.title}</h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY NUCRM ── */}
      <section className="py-16 sm:py-24 px-4 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
              Why teams choose <span className="text-violet-400">NuCRM</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            {[
              { icon: Smartphone, title: 'Built with Next.js 16', desc: 'Blazing fast, SEO-friendly, and fully responsive. Turbopack for instant hot reloading.' },
              { icon: Lock, title: 'Multi-Tenant Security', desc: 'Complete data isolation, row-level security, role-based access, and audit logging for compliance.' },
              { icon: Activity, title: 'Real-Time Dashboard', desc: 'Live KPIs, pipeline health, revenue forecasts, and team activity — all updated instantly.' },
            ].map((item) => (
              <div key={item.title} className="p-6 sm:p-8 rounded-xl sm:rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition">
                <item.icon className="w-7 h-7 sm:w-8 sm:h-8 text-violet-400 mb-3 sm:mb-4" />
                <h3 className="text-lg sm:text-xl font-bold mb-2">{item.title}</h3>
                <p className="text-sm sm:text-base text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="py-16 sm:py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
              Simple, transparent <span className="text-violet-600">pricing</span>
            </h2>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-500">No hidden fees. No surprises. Start free, scale as you grow.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
            {plans.map((plan) => (
              <div key={plan.name} className={`relative p-5 sm:p-6 rounded-xl sm:rounded-2xl border ${plan.highlight ? 'border-violet-500 shadow-lg sm:shadow-xl shadow-violet-100 bg-violet-50/30' : 'border-slate-200 bg-white'}`}>
                {plan.highlight && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-violet-600 text-white text-[10px] sm:text-xs font-semibold rounded-full whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                <h3 className="font-bold text-base sm:text-lg">{plan.name}</h3>
                <p className="text-[11px] sm:text-sm text-slate-600 mt-1">{plan.desc}</p>
                <div className="mt-4 sm:mt-6 mb-5 sm:mb-8">
                  <span className="text-3xl sm:text-5xl font-extrabold">{plan.price}</span>
                  <span className="text-[11px] sm:text-sm text-slate-500">{plan.period}</span>
                </div>
                <ul className="space-y-2 sm:space-y-3 mb-5 sm:mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[11px] sm:text-sm">
                      <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-500 flex-shrink-0 mt-0.5" /> <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/auth/signup" className={`block w-full py-2 sm:py-2.5 rounded-lg text-center text-xs sm:text-sm font-medium transition ${plan.highlight ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 sm:py-24 px-4 bg-gradient-to-br from-violet-600 to-blue-600 text-white text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mb-3 sm:mb-4">
            Ready to close more deals?
          </h2>
          <p className="text-base sm:text-lg text-violet-100 mb-6 sm:mb-10 px-2">
            Join teams using NuCRM to manage pipelines, automate follow-ups, and grow revenue.
          </p>
          <Link href="/auth/signup" className="inline-flex items-center gap-2 px-6 sm:px-8 py-3 sm:py-4 bg-white text-violet-700 rounded-xl hover:bg-violet-50 transition font-semibold text-base sm:text-lg shadow-lg">
            Get Started Free <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-8 sm:py-12 px-4 border-t border-slate-200">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] sm:text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 sm:w-6 sm:h-6 rounded bg-violet-600 flex items-center justify-center">
              <Cpu className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white" />
            </div>
            <span className="font-semibold text-slate-700">NuCRM</span>
            <span>by <a href="https://abetworks.in" className="text-violet-600 hover:underline" target="_blank" rel="noopener noreferrer">abetworks.in</a></span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <a href="#features" className="hover:text-violet-600 transition">Features</a>
            <a href="#pricing" className="hover:text-violet-600 transition">Pricing</a>
            <Link href="/auth/signup" className="hover:text-violet-600 transition">Get Started</Link>
          </div>
          <div>© {new Date().getFullYear()} NuCRM. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
