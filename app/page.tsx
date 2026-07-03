'use client';

import Link from 'next/link';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowRight, Zap, Shield, Bot,
  Check, Globe, Mail, BarChart3,
  TrendingUp, Menu, X, Cpu,
  Sparkles, ArrowUpRight, Layers,
  MessageSquare, Lock, Star,
  Phone, Headphones, GitBranch, Database,
} from 'lucide-react';

/* ─── Scroll-reveal hook ─── */
function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e?.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(40px)',
        transition: `opacity 0.7s cubic-bezier(.16,1,.3,1) ${delay}s, transform 0.7s cubic-bezier(.16,1,.3,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

/* ─── Animated counter ─── */
function AnimatedNumber({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const { ref, visible } = useReveal(0.5);
  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const dur = 1800;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(ease * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [visible, target]);
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

/* ─── Data ─── */
const features = [
  { icon: TrendingUp, title: 'Pipeline Management', desc: 'Visual drag-and-drop deals that give you full visibility into your sales process.', color: 'from-violet-500 to-purple-600' },
  { icon: Bot, title: 'AI Insights', desc: 'Smart scoring and predictions that help you focus on the right opportunities.', color: 'from-indigo-500 to-blue-600' },
  { icon: Mail, title: 'Email Automation', desc: 'Sequences that convert, automatically personalized for each prospect.', color: 'from-cyan-500 to-teal-600' },
  { icon: BarChart3, title: 'Analytics', desc: 'Real-time revenue metrics and reports that drive smarter decisions.', color: 'from-emerald-500 to-green-600' },
  { icon: Shield, title: 'Enterprise Security', desc: 'SOC 2 compliant with SSO, RBAC, and audit logs built in from day one.', color: 'from-amber-500 to-orange-600' },
  { icon: Layers, title: 'Multi-Tenant', desc: 'Run multiple workspaces from one account. Perfect for agencies and holding companies.', color: 'from-rose-500 to-pink-600' },
];

const integrations = [
  { icon: Globe, label: 'Web Forms' },
  { icon: Mail, label: 'Gmail' },
  { icon: MessageSquare, label: 'Slack' },
  { icon: Zap, label: 'Zapier' },
  { icon: GitBranch, label: 'GitHub' },
  { icon: Database, label: 'Stripe' },
  { icon: Phone, label: 'Twilio' },
  { icon: Headphones, label: 'Intercom' },
  { icon: Lock, label: 'SSO/SAML' },
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

const stats = [
  { value: 500, suffix: '+', label: 'Teams' },
  { value: 2, suffix: 'M+', label: 'Deals closed' },
  { value: 99, suffix: '%', label: 'Uptime' },
  { value: 4, suffix: '.9/5', label: 'Rating' },
];

const testimonials = [
  { name: 'Sarah Chen', role: 'VP Sales, TechFlow', quote: 'NuCRM cut our deal cycle by 30%. The AI insights are genuinely useful — not just marketing fluff.', avatar: 'SC' },
  { name: 'Marcus Rodriguez', role: 'Founder, ScaleUp', quote: 'We replaced 4 tools with NuCRM. The pipeline view alone is worth it. My team actually enjoys using it.', avatar: 'MR' },
  { name: 'Aisha Patel', role: 'Head of Revenue, CloudFirst', quote: 'The email sequences are incredible. Open rates jumped 45% with the AI-personalized templates.', avatar: 'AP' },
];

/* ─── Page ─── */
export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 overflow-x-hidden">
      {/* ═══════════ NAV ═══════════ */}
      <nav
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-white/90 backdrop-blur-2xl border-b border-slate-200/60 shadow-sm'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">NuCRM</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-violet-600 transition-colors">Features</a>
            <a href="#integrations" className="hover:text-violet-600 transition-colors">Integrations</a>
            <a href="#pricing" className="hover:text-violet-600 transition-colors">Pricing</a>
            <Link href="/auth/login" className="hover:text-violet-600 transition-colors">Sign In</Link>
            <Link
              href="/auth/signup"
              className="px-5 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-violet-600 hover:shadow-lg hover:shadow-violet-500/25 transition-all duration-300 font-semibold text-sm"
            >
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

        <div className={`md:hidden overflow-hidden transition-all duration-300 ${menuOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="bg-white/95 backdrop-blur-2xl border-t border-slate-100 px-4 py-4 space-y-1">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-600 font-medium hover:text-violet-600 hover:bg-violet-50 rounded-xl transition-all min-h-[44px] flex items-center">Features</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-600 font-medium hover:text-violet-600 hover:bg-violet-50 rounded-xl transition-all min-h-[44px] flex items-center">Pricing</a>
            <Link href="/auth/login" onClick={() => setMenuOpen(false)} className="block py-3 px-3 text-slate-600 font-medium hover:text-violet-600 hover:bg-violet-50 rounded-xl transition-all min-h-[44px] flex items-center">Sign In</Link>
            <Link href="/auth/signup" onClick={() => setMenuOpen(false)} className="block w-full text-center py-3 bg-slate-900 text-white rounded-xl font-semibold text-sm mt-2 min-h-[44px] flex items-center justify-center hover:bg-violet-600 transition-colors">
              Start Free
            </Link>
          </div>
        </div>
      </nav>


      {/* ═══════════ HERO ═══════════ */}
      <section className="relative pt-32 sm:pt-40 pb-24 sm:pb-32 px-4 overflow-hidden">
        {/* Animated background orbs */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-20 left-[10%] w-72 h-72 bg-violet-200 rounded-full blur-3xl opacity-50 animate-pulse" style={{ animationDuration: '4s' }} />
          <div className="absolute top-40 right-[15%] w-96 h-96 bg-indigo-200 rounded-full blur-3xl opacity-30 animate-pulse" style={{ animationDuration: '6s' }} />
          <div className="absolute bottom-20 left-[20%] w-80 h-80 bg-cyan-200 rounded-full blur-3xl opacity-30 animate-pulse" style={{ animationDuration: '5s' }} />
          {/* Grid pattern overlay */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
        </div>

        <div className="max-w-7xl mx-auto text-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-violet-50 border border-violet-100 rounded-full text-sm font-medium text-violet-700 mb-8 hover:bg-violet-100 transition-colors cursor-default">
              <Sparkles className="w-4 h-4" />
              <span>Now with AI-powered insights</span>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <h1 className="text-5xl sm:text-7xl lg:text-[5.5rem] font-extrabold tracking-tight leading-[1.05]">
              <span className="bg-gradient-to-r from-slate-900 via-violet-800 to-indigo-900 bg-clip-text text-transparent">
                Close deals
              </span>
              <br />
              <span className="bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 bg-clip-text text-transparent">
                faster than ever
              </span>
            </h1>
          </Reveal>

          <Reveal delay={0.2}>
            <p className="mt-6 sm:mt-8 text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
              The intelligent CRM that works as hard as your team. Pipeline management,
              AI insights, and email automation — all in one beautiful platform.
            </p>
          </Reveal>

          <Reveal delay={0.3}>
            <div className="mt-10 sm:mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/auth/signup"
                className="group w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-2xl hover:from-violet-700 hover:to-indigo-700 hover:shadow-xl hover:shadow-violet-500/25 hover:-translate-y-0.5 transition-all duration-300 font-semibold text-lg flex items-center justify-center gap-2.5 min-h-[44px]"
              >
                Start Free
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#features"
                className="w-full sm:w-auto px-8 py-4 bg-white/80 backdrop-blur border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 hover:-translate-y-0.5 transition-all duration-300 font-semibold text-lg flex items-center justify-center gap-2.5 min-h-[44px] text-slate-700"
              >
                See Features
              </a>
            </div>
          </Reveal>

          {/* Social proof */}
          <Reveal delay={0.4}>
            <div className="mt-16 sm:mt-20 flex flex-wrap items-center justify-center gap-6 sm:gap-8 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {['VC', 'AK', 'MR', 'JP'].map((initials) => (
                    <div key={initials} className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-400 border-2 border-white flex items-center justify-center text-[9px] font-bold text-white">
                      {initials}
                    </div>
                  ))}
                </div>
                <span className="font-medium text-slate-600">500+ teams</span>
              </div>
              <div className="h-4 w-px bg-slate-200" />
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />
                ))}
                <span className="ml-1 font-medium text-slate-600">4.9/5</span>
              </div>
              <div className="h-4 w-px bg-slate-200 hidden sm:block" />
              <span className="font-medium text-slate-600">No credit card required</span>
            </div>
          </Reveal>
        </div>
      </section>


      {/* ═══════════ STATS BAR ═══════════ */}
      <section className="py-12 px-4 border-y border-slate-100 bg-gradient-to-r from-violet-50/50 via-white to-indigo-50/50">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.1}>
              <div className="text-center">
                <div className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
                  <AnimatedNumber target={s.value} suffix={s.suffix} />
                </div>
                <div className="text-sm text-slate-500 mt-1 font-medium">{s.label}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>


      {/* ═══════════ FEATURES ═══════════ */}
      <section id="features" className="py-24 sm:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold text-violet-600 mb-3 tracking-wide uppercase">Features</p>
              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
                Everything you need
              </h2>
              <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
                Built for modern sales teams who want to move fast and close more deals.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.08}>
                <div className="group relative p-6 sm:p-8 rounded-2xl bg-white border border-slate-200 hover:border-transparent hover:shadow-2xl hover:shadow-violet-500/10 transition-all duration-500 hover:-translate-y-1 overflow-hidden">
                  {/* Gradient hover overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" style={{ background: `linear-gradient(135deg, rgba(139,92,246,0.03), rgba(99,102,241,0.03))` }} />
                  <div className="relative">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-5 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      <f.icon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="font-bold text-lg text-slate-900 mb-2">{f.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>


      {/* ═══════════ AI-POWERED ═══════════ */}
      <section className="py-24 sm:py-32 px-4 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <Reveal>
            <div>
              <p className="text-sm font-semibold text-violet-600 mb-3 tracking-wide uppercase">AI-Powered</p>
              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 mb-6">
                AI that actually closes deals
              </h2>
              <p className="text-lg text-slate-500 mb-8 leading-relaxed">
                Our AI analyzes your pipeline to predict which deals will close, draft follow-ups, and score leads automatically.
              </p>
              <div className="space-y-4">
                {[
                  { text: 'Predict which deals will close this quarter', icon: TrendingUp },
                  { text: 'Draft follow-up emails in your tone', icon: Mail },
                  { text: 'Score leads automatically with ML', icon: Bot },
                ].map((item) => (
                  <div key={item.text} className="flex items-start gap-3 group/item">
                    <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover/item:bg-emerald-200 transition-colors">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                    <span className="text-slate-600">{item.text}</span>
                  </div>
                ))}
              </div>
              <Link
                href="/auth/signup"
                className="inline-flex items-center gap-2 mt-8 text-violet-600 font-semibold hover:text-violet-700 transition-colors group"
              >
                Try AI features
                <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-violet-200/40 to-indigo-200/40 rounded-3xl blur-2xl" />
              <div className="relative rounded-2xl border border-slate-200/80 overflow-hidden shadow-2xl shadow-slate-200/50 bg-white/80 backdrop-blur-xl p-8">
                <div className="bg-white rounded-xl border border-slate-100 p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-md shadow-violet-500/20">
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">AI Deal Prediction</p>
                      <p className="text-xs text-slate-400">Analyzing 24 deals in real-time</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {[
                      { name: 'Enterprise License', prob: 92, color: 'from-emerald-500 to-green-500' },
                      { name: 'Startup Plan', prob: 78, color: 'from-violet-500 to-indigo-500' },
                      { name: 'Agency Tier', prob: 45, color: 'from-amber-500 to-orange-500' },
                    ].map((deal) => (
                      <div key={deal.name} className="group/deal">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-slate-700">{deal.name}</span>
                          <span className="text-sm font-bold text-slate-900">{deal.prob}%</span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-gradient-to-r ${deal.color} rounded-full transition-all duration-1000 ease-out`}
                            style={{ width: `${deal.prob}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>Last updated 2 min ago</span>
                    <span className="flex items-center gap-1 text-emerald-500 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>


      {/* ═══════════ INTEGRATIONS ═══════════ */}
      <section id="integrations" className="py-24 sm:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold text-violet-600 mb-3 tracking-wide uppercase">Integrations</p>
              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
                Connects to everything
              </h2>
              <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
                Plug into the tools your team already uses. No code required.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-9 gap-3 sm:gap-4 max-w-4xl mx-auto">
            {integrations.map((item, i) => (
              <Reveal key={item.label} delay={i * 0.05}>
                <div className="group flex flex-col items-center gap-2.5 p-3 sm:p-4 rounded-2xl hover:bg-violet-50 transition-all duration-300 cursor-default">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white border border-slate-200 group-hover:border-violet-200 group-hover:shadow-lg group-hover:shadow-violet-500/10 flex items-center justify-center transition-all duration-300 group-hover:-translate-y-1">
                    <item.icon className="w-6 h-6 sm:w-7 sm:h-7 text-slate-500 group-hover:text-violet-600 transition-colors" />
                  </div>
                  <span className="text-xs text-slate-500 font-medium group-hover:text-violet-600 transition-colors">{item.label}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>


      {/* ═══════════ TESTIMONIALS ═══════════ */}
      <section className="py-24 sm:py-32 px-4 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold text-violet-600 mb-3 tracking-wide uppercase">Testimonials</p>
              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
                Loved by sales teams
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.12}>
                <div className="group relative p-6 sm:p-8 rounded-2xl bg-white border border-slate-200 hover:border-violet-200 hover:shadow-xl hover:shadow-violet-500/5 transition-all duration-500 hover:-translate-y-1">
                  <div className="flex items-center gap-1 mb-4">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} className="w-4 h-4 text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-slate-600 leading-relaxed mb-6 text-sm sm:text-base">&ldquo;{t.quote}&rdquo;</p>
                  <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white shadow-md shadow-violet-500/20">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                      <p className="text-xs text-slate-400">{t.role}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>


      {/* ═══════════ PRICING ═══════════ */}
      <section id="pricing" className="py-24 sm:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold text-violet-600 mb-3 tracking-wide uppercase">Pricing</p>
              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
                Simple pricing
              </h2>
              <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
                Start free, upgrade when you&apos;re ready. No hidden fees.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {plans.map((plan, i) => (
              <Reveal key={plan.name} delay={i * 0.1}>
                <div
                  className={`relative p-6 sm:p-8 rounded-2xl transition-all duration-500 hover:-translate-y-2 ${
                    plan.highlight
                      ? 'bg-gradient-to-br from-slate-900 to-violet-950 text-white border-2 border-violet-500/30 shadow-2xl shadow-violet-500/20'
                      : 'bg-white border border-slate-200 hover:border-violet-200 hover:shadow-xl hover:shadow-slate-200/50'
                  }`}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-5 py-1 bg-gradient-to-r from-violet-500 to-indigo-500 text-white text-xs font-bold rounded-full shadow-lg shadow-violet-500/30">
                      Most Popular
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
                    className={`block w-full py-3 rounded-xl text-center text-sm font-semibold transition-all duration-300 min-h-[44px] flex items-center justify-center ${
                      plan.highlight
                        ? 'bg-white text-slate-900 hover:bg-slate-100 hover:shadow-lg'
                        : 'bg-slate-900 text-white hover:bg-violet-600 hover:shadow-lg hover:shadow-violet-500/25'
                    }`}
                  >
                    {plan.cta}
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>


      {/* ═══════════ CTA ═══════════ */}
      <section className="relative py-24 sm:py-32 px-4 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600 via-indigo-600 to-violet-700" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] bg-[size:40px_40px]" />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-300/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-3xl mx-auto text-center text-white relative">
          <Reveal>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-6">
              Ready to grow?
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-lg sm:text-xl text-white/70 mb-10 max-w-xl mx-auto">
              Join hundreds of teams closing more deals with NuCRM.
            </p>
          </Reveal>
          <Reveal delay={0.2}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/auth/signup"
                className="group w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 bg-white text-slate-900 rounded-2xl hover:bg-slate-100 hover:-translate-y-0.5 transition-all duration-300 font-bold text-lg shadow-xl min-h-[44px]"
              >
                Start Free
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/auth/login"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 bg-white/10 backdrop-blur text-white rounded-2xl border border-white/20 hover:bg-white/20 hover:-translate-y-0.5 transition-all duration-300 font-semibold text-lg min-h-[44px]"
              >
                Sign In
              </Link>
            </div>
          </Reveal>
        </div>
      </section>


      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="py-12 sm:py-16 px-4 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                  <Cpu className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-lg text-slate-900">NuCRM</span>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                The intelligent CRM for modern sales teams. Close deals faster with AI-powered insights.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-sm text-slate-900 mb-4">Product</h4>
              <ul className="space-y-2.5 text-sm text-slate-500">
                <li><a href="#features" className="hover:text-violet-600 transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-violet-600 transition-colors">Pricing</a></li>
                <li><a href="#integrations" className="hover:text-violet-600 transition-colors">Integrations</a></li>
                <li><Link href="/docs" className="hover:text-violet-600 transition-colors">Documentation</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-sm text-slate-900 mb-4">Company</h4>
              <ul className="space-y-2.5 text-sm text-slate-500">
                <li><span className="hover:text-violet-600 transition-colors cursor-pointer">About</span></li>
                <li><span className="hover:text-violet-600 transition-colors cursor-pointer">Blog</span></li>
                <li><span className="hover:text-violet-600 transition-colors cursor-pointer">Careers</span></li>
                <li><span className="hover:text-violet-600 transition-colors cursor-pointer">Contact</span></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-sm text-slate-900 mb-4">Legal</h4>
              <ul className="space-y-2.5 text-sm text-slate-500">
                <li><span className="hover:text-violet-600 transition-colors cursor-pointer">Privacy</span></li>
                <li><span className="hover:text-violet-600 transition-colors cursor-pointer">Terms</span></li>
                <li><span className="hover:text-violet-600 transition-colors cursor-pointer">Security</span></li>
                <li><span className="hover:text-violet-600 transition-colors cursor-pointer">GDPR</span></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-slate-400">
              &copy; {new Date().getFullYear()} NuCRM. All rights reserved.
            </div>
            <div className="flex items-center gap-6 text-sm text-slate-400">
              <Link href="/auth/login" className="hover:text-violet-600 transition-colors">Sign In</Link>
              <Link href="/auth/signup" className="hover:text-violet-600 transition-colors">Start Free</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
