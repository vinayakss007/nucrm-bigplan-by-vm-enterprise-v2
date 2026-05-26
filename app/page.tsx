'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import {
  Shield, Zap, Users, TrendingUp, CheckCircle, BarChart3, Mail,
  Lock, Cloud, ArrowRight, Star, Building2, Globe, Cpu, Activity,
  Target, Layers, GitBranch, Bot, Wallet, Megaphone,
  Settings, Rocket, ChevronDown, Menu, X, Sparkles, Play
} from 'lucide-react';


const features = [
  { icon: Target, title: 'Lead Management', desc: 'Track every lead from first touch to closed deal with rich profiles and activity timelines.' },
  { icon: GitBranch, title: 'Sales Pipelines', desc: 'Visual Kanban boards with drag-and-drop. Create unlimited custom pipelines per team.' },
  { icon: Mail, title: 'Email Sequences', desc: 'Automated multi-step campaigns with open/click analytics and A/B testing built in.' },
  { icon: Bot, title: 'AI Assistant', desc: 'AI-powered insights, email drafting, contact scoring, and intelligent churn predictions.' },
  { icon: BarChart3, title: 'Advanced Analytics', desc: 'Custom dashboards, saved reports, revenue projections, and pipeline health metrics.' },
  { icon: Shield, title: 'Enterprise Security', desc: 'RBAC, data isolation, audit logs, 2FA, SSO/SAML support, and field-level permissions.' },
  { icon: Megaphone, title: 'Marketing Automation', desc: 'Capture leads via forms, score them automatically, and route to the right sales rep.' },
  { icon: Layers, title: 'Custom Objects', desc: 'Extend any entity with custom fields, tags, and relationships. Adapt to your workflow.' },
  { icon: Globe, title: 'Multi-Tenant SaaS', desc: 'Built for scale with isolated tenant data, billing management, and usage limits.' },
];


const stats = [
  { value: 500, suffix: '+', label: 'Companies Trust Us' },
  { value: 30, suffix: '%', label: 'Faster Close Rate' },
  { value: 99.9, suffix: '%', label: 'Uptime SLA' },
  { value: 10, suffix: 'K+', label: 'Deals Managed Daily' },
];

const plans = [
  { name: 'Free', price: '$0', period: '/forever', desc: 'For individuals getting started', features: ['Up to 2 users', '1 pipeline', '100 contacts', 'Basic reports', 'Community support'], cta: 'Start Free', highlight: false },
  { name: 'Starter', price: '$29', period: '/mo', desc: 'For small teams', features: ['Up to 10 users', '5 pipelines', '10K contacts', 'Email sequences', 'Priority support', 'API access'], cta: 'Start Trial', highlight: false },
  { name: 'Pro', price: '$79', period: '/mo', desc: 'For growing organizations', features: ['Unlimited users', 'Unlimited pipelines', '100K contacts', 'AI assistant', 'Advanced analytics', 'Custom objects', 'SSO/SAML'], cta: 'Start Trial', highlight: true },
  { name: 'Enterprise', price: 'Custom', period: '', desc: 'For large organizations', features: ['Everything in Pro', 'Dedicated CSM', 'Custom integrations', 'SLA guarantee', 'On-premise option', 'Audit logs', 'White-label'], cta: 'Contact Sales', highlight: false },
];


const testimonials = [
  { name: 'Sarah Chen', role: 'VP Sales, TechFlow', quote: 'NuCRM transformed our sales process. We closed 40% more deals in the first quarter after switching.' },
  { name: 'Marcus Johnson', role: 'CEO, ScaleUp Inc', quote: 'The AI insights alone saved our team 15 hours per week. The pipeline visibility is unmatched.' },
  { name: 'Elena Rodriguez', role: 'Head of Revenue, Nexus', quote: 'Enterprise-grade security with startup-level speed. NuCRM is exactly what we needed to scale.' },
];

const logos = ['Acme Corp', 'TechFlow', 'ScaleUp', 'Nexus', 'Orbit'];


function AnimatedCounter({ value, suffix }: { value: number; suffix: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          const duration = 2000;
          const steps = 60;
          const increment = value / steps;
          let current = 0;
          const timer = setInterval(() => {
            current += increment;
            if (current >= value) {
              setCount(value);
              clearInterval(timer);
            } else {
              setCount(Math.floor(current * 10) / 10);
            }
          }, duration / steps);
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [value, hasAnimated]);

  return (
    <div ref={ref} className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white tabular-nums">
      {count % 1 === 0 ? Math.floor(count) : count.toFixed(1)}{suffix}
    </div>
  );
}


export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-x-hidden scroll-smooth">
      {/* NAV */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight dark:text-white">NuCRM</span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600 dark:text-slate-400">
            <a href="#features" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">Pricing</a>
            <a href="#testimonials" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">Testimonials</a>
            <Link href="/auth/login" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">Sign In</Link>
            <Link href="/auth/signup" className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-violet-500/25 transition-all duration-300 font-semibold text-sm">
              Start Free
            </Link>
          </div>


          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile dropdown */}
        <div className={`md:hidden overflow-hidden transition-all duration-300 ${menuOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/50 dark:border-slate-800/50 px-4 py-4 space-y-1">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-700 dark:text-slate-300 font-medium hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 rounded-xl transition-all min-h-[44px] flex items-center">Features</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-700 dark:text-slate-300 font-medium hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 rounded-xl transition-all min-h-[44px] flex items-center">Pricing</a>
            <a href="#testimonials" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-700 dark:text-slate-300 font-medium hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 rounded-xl transition-all min-h-[44px] flex items-center">Testimonials</a>
            <Link href="/auth/login" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-700 dark:text-slate-300 font-medium hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 rounded-xl transition-all min-h-[44px] flex items-center">Sign In</Link>
            <Link href="/auth/signup" onClick={() => setMenuOpen(false)} className="block w-full text-center py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl font-semibold text-sm mt-2 min-h-[44px] flex items-center justify-center">
              Start Free
            </Link>
          </div>
        </div>
      </nav>


      {/* HERO */}
      <section className="relative pt-32 sm:pt-40 pb-20 sm:pb-32 px-4 overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-950 dark:to-violet-950/30" />
          <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-violet-200/40 dark:bg-violet-600/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-indigo-200/40 dark:bg-indigo-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-gradient-to-r from-violet-100/50 to-indigo-100/50 dark:from-violet-900/10 dark:to-indigo-900/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-100/80 dark:bg-violet-900/30 border border-violet-200/50 dark:border-violet-700/30 backdrop-blur-sm mb-8">
              <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">Trusted by 500+ companies worldwide</span>
            </div>

            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]">
              <span className="dark:text-white">The CRM that</span>
              <br />
              <span className="bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent bg-[length:200%_auto] animate-[gradient_3s_linear_infinite]">accelerates revenue</span>
            </h1>


            <p className="mt-6 sm:mt-8 text-lg sm:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Pipeline management, email sequences, AI insights, and enterprise security.
              Everything your team needs to close deals faster.
            </p>

            <div className="mt-10 sm:mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/auth/signup"
                className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-2xl hover:shadow-xl hover:shadow-violet-500/25 hover:-translate-y-0.5 transition-all duration-300 font-semibold text-lg flex items-center justify-center gap-2.5 min-h-[44px]"
              >
                Start Free <ArrowRight className="w-5 h-5" />
              </Link>
              <a
                href="#features"
                className="w-full sm:w-auto px-8 py-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-violet-300 dark:hover:border-violet-600 hover:-translate-y-0.5 transition-all duration-300 font-semibold text-lg flex items-center justify-center gap-2.5 min-h-[44px]"
              >
                <Play className="w-5 h-5 text-violet-600" /> See Demo
              </a>
            </div>
          </div>


          {/* Floating UI Mockup */}
          <div className="mt-16 sm:mt-20 relative max-w-4xl mx-auto">
            <div className="relative bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl sm:rounded-3xl border border-slate-200/50 dark:border-slate-700/50 shadow-2xl shadow-violet-500/10 p-4 sm:p-6">
              {/* Window chrome */}
              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="px-4 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 font-mono">app.nucrm.io/pipeline</div>
                </div>
              </div>
              {/* Kanban mockup */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 sm:gap-4">
                {['Lead', 'Qualified', 'Proposal', 'Won'].map((stage, i) => (
                  <div key={stage} className={`space-y-2 sm:space-y-3 ${i === 3 ? 'hidden sm:block' : ''}`}>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{stage}</div>
                    {[1, 2].map((card) => (
                      <div
                        key={card}
                        className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-800/50 border border-slate-100 dark:border-slate-700 shadow-sm"
                      >
                        <div className="h-2 w-16 sm:w-20 rounded-full bg-slate-200 dark:bg-slate-700 mb-2" />
                        <div className="h-2 w-10 sm:w-12 rounded-full bg-slate-100 dark:bg-slate-700/50" />
                        <div className="mt-3 flex items-center justify-between">
                          <div className={`text-xs font-bold ${i === 3 ? 'text-emerald-600' : 'text-violet-600'}`}>
                            ${(Math.floor(Math.random() * 50) + 10) * 1000}
                          </div>
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {/* Floating decorative elements */}
            <div className="absolute -top-4 -right-4 w-20 h-20 bg-gradient-to-br from-violet-500 to-indigo-500 rounded-2xl opacity-10 blur-xl" />
            <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-2xl opacity-10 blur-xl" />
          </div>
        </div>
      </section>


      {/* SOCIAL PROOF / LOGOS */}
      <section className="py-12 sm:py-16 border-y border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4">
          <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 mb-8">Trusted by 500+ companies from startups to enterprise</p>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {logos.map((logo) => (
              <div key={logo} className="flex items-center gap-2 text-slate-400 dark:text-slate-600">
                <Building2 className="w-5 h-5" />
                <span className="text-base font-semibold tracking-wide">{logo}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="py-16 sm:py-24 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-12">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <AnimatedCounter value={s.value} suffix={s.suffix} />
              <div className="text-sm sm:text-base text-slate-600 dark:text-slate-400 mt-2 font-medium">{s.label}</div>
            </div>
          ))}
        </div>
      </section>


      {/* FEATURES GRID */}
      <section id="features" className="py-16 sm:py-24 px-4 bg-slate-50/50 dark:bg-slate-900/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-100/80 dark:bg-violet-900/30 border border-violet-200/50 dark:border-violet-700/30 mb-4">
              <Zap className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Powerful Features</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight dark:text-white">
              Everything your team needs
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
              From first contact to closed deal, NuCRM covers every step of your revenue engine.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="group relative p-6 sm:p-8 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm hover:border-violet-300 dark:hover:border-violet-600/50 hover:shadow-xl hover:shadow-violet-500/5 hover:-translate-y-1 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/40 dark:to-indigo-900/40 flex items-center justify-center mb-5 group-hover:from-violet-600 group-hover:to-indigo-600 transition-all duration-300">
                  <f.icon className="w-6 h-6 text-violet-600 dark:text-violet-400 group-hover:text-white transition-colors duration-300" />
                </div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* PRICING */}
      <section id="pricing" className="py-16 sm:py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-100/80 dark:bg-violet-900/30 border border-violet-200/50 dark:border-violet-700/30 mb-4">
              <Wallet className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Simple Pricing</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight dark:text-white">
              Plans that scale with you
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
              Start free, upgrade as you grow. No hidden fees, no surprises.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative p-6 sm:p-8 rounded-2xl border transition-all duration-300 hover:-translate-y-1 ${
                  plan.highlight
                    ? 'border-violet-500/50 bg-gradient-to-b from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-900 shadow-xl shadow-violet-500/10 ring-1 ring-violet-500/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm hover:shadow-lg hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-bold rounded-full shadow-lg">
                    Most Popular
                  </div>
                )}
                <h3 className="font-bold text-lg dark:text-white">{plan.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{plan.desc}</p>
                <div className="mt-6 mb-6">
                  <span className="text-4xl sm:text-5xl font-extrabold dark:text-white">{plan.price}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400 ml-1">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                      <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className={`block w-full py-3 rounded-xl text-center text-sm font-semibold transition-all duration-300 min-h-[44px] flex items-center justify-center ${
                    plan.highlight
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:shadow-lg hover:shadow-violet-500/25'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* TESTIMONIALS */}
      <section id="testimonials" className="py-16 sm:py-24 px-4 bg-slate-50/50 dark:bg-slate-900/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-100/80 dark:bg-violet-900/30 border border-violet-200/50 dark:border-violet-700/30 mb-4">
              <Star className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Customer Stories</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight dark:text-white">
              Loved by sales teams
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className="relative p-6 sm:p-8 rounded-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200/80 dark:border-slate-800/80 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                <div className="flex gap-1 mb-4">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className="w-4 h-4 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed mb-6 text-sm sm:text-base">&ldquo;{t.quote}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">
                    {t.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-white">{t.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* FINAL CTA */}
      <section className="py-20 sm:py-32 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600 via-indigo-600 to-violet-700 -z-10" />
        <div className="absolute inset-0 -z-10 opacity-30">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-indigo-300/20 rounded-full blur-3xl" />
        </div>
        <div className="max-w-3xl mx-auto text-center text-white">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4 sm:mb-6">
            Ready to accelerate your revenue?
          </h2>
          <p className="text-lg sm:text-xl text-violet-100 mb-8 sm:mb-12 max-w-xl mx-auto leading-relaxed">
            Join hundreds of teams using NuCRM to close more deals, faster. Start free today.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="w-full sm:w-auto px-8 py-4 bg-white text-violet-700 rounded-2xl hover:bg-violet-50 hover:-translate-y-0.5 transition-all duration-300 font-bold text-lg shadow-xl flex items-center justify-center gap-2.5 min-h-[44px]"
            >
              Start Free <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/auth/login"
              className="w-full sm:w-auto px-8 py-4 bg-white/10 backdrop-blur-sm border border-white/20 text-white rounded-2xl hover:bg-white/20 hover:-translate-y-0.5 transition-all duration-300 font-semibold text-lg flex items-center justify-center gap-2.5 min-h-[44px]"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>


      {/* FOOTER */}
      <footer className="py-12 sm:py-16 px-4 border-t border-slate-200/50 dark:border-slate-800/50 bg-white dark:bg-slate-950">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                <Cpu className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-lg text-slate-900 dark:text-white">NuCRM</span>
            </div>
            <div className="flex items-center gap-6 sm:gap-8 text-sm font-medium text-slate-600 dark:text-slate-400">
              <a href="#features" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">Features</a>
              <a href="#pricing" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">Pricing</a>
              <a href="#testimonials" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">Testimonials</a>
              <Link href="/auth/login" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors">Sign In</Link>
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-500">
              {new Date().getFullYear()} NuCRM. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
