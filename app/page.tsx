'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';
import {
  Sparkles, ArrowRight, Zap, Shield, Bot, Puzzle,
  Check, ChevronRight, Play, Globe, Mail, BarChart3,
  Users, TrendingUp, Building2, Menu, X, Cpu
} from 'lucide-react';


const features = [
  { icon: TrendingUp, title: 'Pipeline Management', desc: 'Visual drag-and-drop deals' },
  { icon: Bot, title: 'AI Insights', desc: 'Smart scoring and predictions' },
  { icon: Mail, title: 'Email Automation', desc: 'Sequences that convert' },
  { icon: BarChart3, title: 'Analytics', desc: 'Real-time revenue metrics' },
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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, []);

  return (
    <div className="dark min-h-screen bg-slate-950 text-slate-100 overflow-x-hidden scroll-smooth">
      {/* NAV */}
      <nav className="fixed top-0 w-full z-50 bg-slate-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">NuCRM</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
            <a href="#features" className="hover:text-violet-400 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-violet-400 transition-colors">Pricing</a>
            <Link href="/auth/login" className="hover:text-violet-400 transition-colors">Sign In</Link>
            <Link href="/auth/signup" className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-violet-500/25 transition-all duration-300 font-semibold text-sm">
              Start Free
            </Link>
          </div>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2.5 rounded-xl hover:bg-white/5 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <div className={`md:hidden overflow-hidden transition-all duration-300 ${menuOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="bg-slate-900/95 backdrop-blur-xl border-t border-white/5 px-4 py-4 space-y-1">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-300 font-medium hover:text-violet-400 hover:bg-violet-950/30 rounded-xl transition-all min-h-[44px] flex items-center">Features</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-300 font-medium hover:text-violet-400 hover:bg-violet-950/30 rounded-xl transition-all min-h-[44px] flex items-center">Pricing</a>
            <Link href="/auth/login" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-300 font-medium hover:text-violet-400 hover:bg-violet-950/30 rounded-xl transition-all min-h-[44px] flex items-center">Sign In</Link>
            <Link href="/auth/signup" onClick={() => setMenuOpen(false)} className="block w-full text-center py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl font-semibold text-sm mt-2 min-h-[44px] flex items-center justify-center">
              Start Free
            </Link>
          </div>
        </div>
      </nav>


      {/* HERO */}
      <section className="relative pt-32 sm:pt-40 pb-24 sm:pb-32 px-4 overflow-hidden">
        {/* Floating background shapes */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-20 left-[10%] w-72 h-72 bg-violet-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '0s' }} />
          <div className="absolute top-40 right-[15%] w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-float-slow" style={{ animationDelay: '2s' }} />
          <div className="absolute bottom-20 left-[20%] w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '4s' }} />
          <div className="absolute top-60 left-[50%] w-48 h-48 bg-violet-500/10 rounded-2xl blur-3xl animate-float-slow" style={{ animationDelay: '1s' }} />
          <div className="absolute bottom-40 right-[10%] w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '3s' }} />
          <div className="absolute top-10 right-[40%] w-56 h-56 bg-cyan-500/8 rounded-2xl blur-3xl animate-float-slow" style={{ animationDelay: '5s' }} />
        </div>

        <div className="max-w-7xl mx-auto text-center">
          <div className={`transition-all duration-1000 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            <h1 className="text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[1.05]">
              <span className="bg-gradient-to-r from-violet-400 via-cyan-400 to-violet-400 bg-clip-text text-transparent animate-gradient-x">
                Close deals faster with AI
              </span>
              <span className="animate-typing-cursor text-violet-400">|</span>
            </h1>

            <p className="mt-6 sm:mt-8 text-lg sm:text-xl text-slate-400 max-w-xl mx-auto">
              The intelligent CRM that works as hard as your team.
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
                className="w-full sm:w-auto px-8 py-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl hover:bg-white/10 hover:border-violet-500/30 hover:-translate-y-0.5 transition-all duration-300 font-semibold text-lg flex items-center justify-center gap-2.5 min-h-[44px] text-slate-200"
              >
                <Play className="w-5 h-5 text-violet-400" /> Watch Demo
              </a>
            </div>
          </div>

          {/* Hero image */}
          <div className="mt-16 sm:mt-20 relative max-w-5xl mx-auto">
            <div className="relative rounded-2xl border border-white/10 shadow-2xl shadow-violet-500/20 overflow-hidden">
              <Image
                src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&h=700&fit=crop"
                alt="Analytics dashboard showing revenue metrics and sales pipeline visualization"
                width={1200}
                height={700}
                className="w-full h-auto"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
            </div>
            {/* Glow effects around image */}
            <div className="absolute -top-4 -right-4 w-32 h-32 bg-violet-500/20 rounded-full blur-2xl" />
            <div className="absolute -bottom-4 -left-4 w-40 h-40 bg-indigo-500/20 rounded-full blur-2xl" />
          </div>
        </div>
      </section>


      {/* SOCIAL PROOF BAR */}
      <section className="py-12 sm:py-16 border-y border-white/5 bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4">
          <p className="text-center text-sm font-medium text-slate-500 mb-8">Trusted by 500+ teams worldwide</p>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {logos.map((logo) => (
              <div key={logo} className="flex items-center gap-2 text-slate-500">
                <Building2 className="w-5 h-5" />
                <span className="text-base font-semibold tracking-wide">{logo}</span>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* FEATURES */}
      <section id="features" className="py-24 sm:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
              Everything you need
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="group relative p-6 sm:p-8 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 hover:scale-105 hover:border-violet-500/30 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-5 shadow-lg shadow-violet-500/20">
                  <f.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-bold text-lg text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* AI-POWERED SECTION */}
      <section className="py-24 sm:py-32 px-4 relative overflow-hidden">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-8">
              AI that closes deals
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-300">Predict which deals will close this quarter</span>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-300">Draft follow-up emails in your tone</span>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-300">Score leads automatically with ML</span>
              </div>
            </div>
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 mt-8 text-violet-400 font-semibold hover:text-violet-300 transition-colors"
            >
              Try AI features <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="relative">
            <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl shadow-violet-500/10">
              <Image
                src="https://images.unsplash.com/photo-1535378917042-10a22c95931a?w=800&h=600&fit=crop"
                alt="Abstract visualization of machine learning algorithms analyzing data patterns"
                width={800}
                height={600}
                className="w-full h-auto"
              />
            </div>
            {/* Floating sparkles */}
            <div className="absolute -top-4 -right-4 animate-float" style={{ animationDelay: '0s' }}>
              <Sparkles className="w-8 h-8 text-violet-400/60" />
            </div>
            <div className="absolute -bottom-4 -left-4 animate-float" style={{ animationDelay: '2s' }}>
              <Sparkles className="w-6 h-6 text-cyan-400/60" />
            </div>
            <div className="absolute top-1/2 -right-8 animate-float-slow" style={{ animationDelay: '1s' }}>
              <Sparkles className="w-5 h-5 text-indigo-400/60" />
            </div>
          </div>
        </div>
      </section>


      {/* INTEGRATIONS */}
      <section className="py-24 sm:py-32 px-4 relative overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
              Connects to everything
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="relative">
              {/* Integration dots grid */}
              <div className="grid grid-cols-3 gap-6 max-w-xs mx-auto lg:mx-0">
                {integrations.map((item, i) => (
                  <div key={item.label} className="flex flex-col items-center gap-2">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-center hover:border-violet-500/30 hover:scale-110 transition-all duration-300">
                      <item.icon className="w-7 h-7 text-violet-400" />
                    </div>
                    <span className="text-xs text-slate-500 font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
              {/* Animated connecting lines */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 -z-10">
                <div className="absolute inset-0 rounded-full border border-violet-500/10 animate-pulse-ring" />
                <div className="absolute inset-4 rounded-full border border-indigo-500/10 animate-pulse-ring" style={{ animationDelay: '0.5s' }} />
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl shadow-violet-500/10">
              <Image
                src="https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800&h=600&fit=crop"
                alt="Modern workspace with connected technology tools and integrations"
                width={800}
                height={600}
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>


      {/* PRICING */}
      <section id="pricing" className="py-24 sm:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
              Simple pricing
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative p-6 sm:p-8 rounded-2xl transition-all duration-300 hover:-translate-y-1 ${
                  plan.highlight
                    ? 'bg-white/5 backdrop-blur-xl border-2 border-violet-500/50 shadow-xl shadow-violet-500/10'
                    : 'bg-white/5 backdrop-blur-xl border border-white/10 hover:border-white/20'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-bold rounded-full shadow-lg">
                    Popular
                  </div>
                )}
                <h3 className="font-bold text-lg text-white">{plan.name}</h3>
                <div className="mt-4 mb-6">
                  <span className="text-4xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-sm text-slate-400 ml-1">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className={`block w-full py-3 rounded-xl text-center text-sm font-semibold transition-all duration-300 min-h-[44px] flex items-center justify-center ${
                    plan.highlight
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:shadow-lg hover:shadow-violet-500/25'
                      : 'bg-white/10 text-slate-300 hover:bg-white/15'
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
      <section className="py-24 sm:py-32 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600 via-indigo-600 to-violet-700 -z-10" />
        <div className="absolute inset-0 -z-10 opacity-30">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/10 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-indigo-300/20 rounded-full blur-3xl animate-float-slow" />
        </div>
        <div className="max-w-3xl mx-auto text-center text-white">
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-6">
            Ready to grow?
          </h2>
          <p className="text-lg sm:text-xl text-violet-100 mb-10 max-w-xl mx-auto">
            Join hundreds of teams closing more deals with NuCRM.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2.5 px-8 py-4 bg-white text-violet-700 rounded-2xl hover:bg-violet-50 hover:-translate-y-0.5 transition-all duration-300 font-bold text-lg shadow-xl min-h-[44px]"
          >
            Start Free <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>


      {/* FOOTER */}
      <footer className="py-12 sm:py-16 px-4 border-t border-white/5 bg-slate-950">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                <Cpu className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-lg text-white">NuCRM</span>
            </div>
            <div className="flex items-center gap-6 sm:gap-8 text-sm font-medium text-slate-400">
              <a href="#features" className="hover:text-violet-400 transition-colors">Features</a>
              <a href="#pricing" className="hover:text-violet-400 transition-colors">Pricing</a>
              <Link href="/auth/login" className="hover:text-violet-400 transition-colors">Sign In</Link>
              <Link href="/auth/signup" className="hover:text-violet-400 transition-colors">Start Free</Link>
            </div>
            <div className="text-sm text-slate-500">
              {new Date().getFullYear()} NuCRM. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
