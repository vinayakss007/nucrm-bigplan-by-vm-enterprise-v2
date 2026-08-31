/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { Icon } from './icon';

/**
 * Product visuals.
 *
 * These are hand-built representations of real NuCRM screens rather than
 * screenshots: there are no marketing image assets in this repository, and
 * drawing them in markup keeps them crisp, themeable, translatable and free of
 * a 400kB PNG on first paint. Every panel mirrors a screen that exists in the
 * product — the pipeline board, the AI drafting panel, the automation builder,
 * the unified conversation timeline, the report builder and the quote editor.
 *
 * All numbers are illustrative sample data, clearly generic, never presented as
 * a customer metric.
 */

/* ───────────────────────────── chrome ──────────────────────────────── */

function WindowChrome({ title, right }: { title: string; right?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.07] bg-white/[0.03] px-4 py-2.5">
      <div className="flex gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/70" />
      </div>
      <span className="mk-mono truncate text-slate-500">{title}</span>
      {right && <span className="mk-mono ml-auto hidden text-slate-600 sm:block">{right}</span>}
    </div>
  );
}

export function MockFrame({
  children,
  title,
  right,
  className = '',
}: {
  children: React.ReactNode;
  title: string;
  right?: string;
  className?: string;
}) {
  return (
    <div
      className={`mk-edge overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0a1330]/90 shadow-[0_40px_100px_-40px_rgba(3,10,35,0.9)] backdrop-blur-xl ${className}`}
    >
      <WindowChrome title={title} right={right} />
      {children}
    </div>
  );
}

/* ──────────────────────────── hero preview ─────────────────────────── */

const NAV = [
  { icon: 'LayoutDashboard', label: 'Dashboard' },
  { icon: 'Target', label: 'Leads' },
  { icon: 'Kanban', label: 'Deals', active: true },
  { icon: 'Users', label: 'Contacts' },
  { icon: 'MessagesSquare', label: 'Inbox' },
  { icon: 'Ticket', label: 'Tickets' },
  { icon: 'Receipt', label: 'Invoices' },
  { icon: 'Zap', label: 'Automation' },
  { icon: 'BarChart3', label: 'Reports' },
];

const COLUMNS: { name: string; total: string; tone: string; cards: { co: string; value: string; owner: string; score?: number; tag?: string }[] }[] = [
  {
    name: 'Qualified',
    total: '$84k',
    tone: 'bg-slate-400',
    cards: [
      { co: 'Northwind Trading', value: '$32,000', owner: 'AK', score: 74, tag: 'Inbound' },
      { co: 'Vertex Labs', value: '$28,500', owner: 'MR', score: 61 },
      { co: 'Halden Group', value: '$23,500', owner: 'JP' },
    ],
  },
  {
    name: 'Proposal',
    total: '$127k',
    tone: 'bg-sky-400',
    cards: [
      { co: 'Meridian Health', value: '$74,000', owner: 'VC', score: 92, tag: 'Quote sent' },
      { co: 'Cobalt Studio', value: '$53,000', owner: 'AK', score: 68 },
    ],
  },
  {
    name: 'Negotiation',
    total: '$96k',
    tone: 'bg-cyan-400',
    cards: [
      { co: 'Foxglove Retail', value: '$61,000', owner: 'MR', score: 88, tag: 'Signature' },
      { co: 'Arden & Co', value: '$35,000', owner: 'JP', score: 55 },
    ],
  },
  {
    name: 'Won',
    total: '$58k',
    tone: 'bg-emerald-400',
    cards: [{ co: 'Solstice Media', value: '$58,000', owner: 'VC', tag: 'Invoiced' }],
  },
];

function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 80 ? 'text-emerald-300 bg-emerald-500/12 border-emerald-400/25' : score >= 65 ? 'text-sky-300 bg-sky-500/12 border-sky-400/25' : 'text-amber-300 bg-amber-500/12 border-amber-400/25';
  return (
    <span className={`mk-mono rounded-md border px-1.5 py-[1px] text-[10px] font-semibold ${tone}`}>{score}</span>
  );
}

/**
 * The hero visual: the deals board as it appears in the product, with the
 * sidebar, the workspace switcher, an AI insight rail and live totals.
 */
export function AppPreview() {
  return (
    <MockFrame title="nucrm — deals · Q3 pipeline" right="Acme Group · 14 members">
      <div className="flex">
        {/* sidebar */}
        <aside className="hidden w-[186px] shrink-0 flex-col border-r border-white/[0.06] bg-black/25 p-3 md:flex">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-sky-400 text-[10px] font-bold text-white">
              A
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold text-slate-200">Acme Group</span>
              <span className="block text-[9px] text-slate-500">Pro workspace</span>
            </span>
            <Icon name="ChevronDown" className="h-3 w-3 text-slate-500" />
          </div>
          {NAV.map((n) => (
            <span
              key={n.label}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[11.5px] font-medium ${
                n.active ? 'bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-400/20' : 'text-slate-500'
              }`}
            >
              <Icon name={n.icon} className="h-3.5 w-3.5" />
              {n.label}
            </span>
          ))}
          <div className="mt-auto flex items-center gap-2 rounded-lg border border-white/[0.06] px-2.5 py-2">
            <Icon name="Sparkles" className="h-3.5 w-3.5 text-sky-300" />
            <span className="text-[10px] text-slate-400">AI credits</span>
            <span className="mk-mono ml-auto text-[10px] text-slate-300">82%</span>
          </div>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1">
          {/* toolbar */}
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <span className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10.5px] text-slate-400">
              <Icon name="Filter" className="h-3 w-3" /> This quarter
            </span>
            <span className="hidden items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10.5px] text-slate-400 sm:flex">
              <Icon name="Users" className="h-3 w-3" /> All owners
            </span>
            {/* Spelled out rather than the ⌘ glyph, which renders as tofu in the
                mock's monospace stack. */}
            <span className="mk-mono ml-auto hidden text-[10px] text-slate-500 sm:block">Cmd K</span>
            <span className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 px-2.5 py-1 text-[10.5px] font-semibold text-white">
              New deal
            </span>
          </div>

          <div className="flex">
            {/* board */}
            <div className="min-w-0 flex-1 overflow-hidden p-3">
              <div className="flex gap-2.5">
                {COLUMNS.map((col, ci) => (
                  <div key={col.name} className={`min-w-0 flex-1 ${ci > 1 ? 'hidden sm:block' : ''} ${ci > 2 ? 'hidden lg:block' : ''}`}>
                    <div className="mb-2 flex items-center gap-1.5 px-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${col.tone}`} />
                      <span className="truncate text-[10.5px] font-semibold text-slate-300">{col.name}</span>
                      <span className="mk-mono ml-auto text-[10px] text-slate-500">{col.total}</span>
                    </div>
                    <div className="space-y-2">
                      {col.cards.map((c) => (
                        <div
                          key={c.co}
                          className="rounded-lg border border-white/[0.07] bg-white/[0.028] p-2.5 transition-colors hover:border-sky-400/25 hover:bg-white/[0.05]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate text-[11px] font-semibold text-slate-100">{c.co}</span>
                            {c.score !== undefined && <ScorePill score={c.score} />}
                          </div>
                          <div className="mk-mono mt-1.5 text-[11px] text-slate-300">{c.value}</div>
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-sky-400 text-[7px] font-bold text-white">
                              {c.owner}
                            </span>
                            {c.tag && (
                              <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-[1px] text-[9px] text-slate-400">
                                {c.tag}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* insight rail */}
            <aside className="hidden w-[188px] shrink-0 border-l border-white/[0.06] bg-black/20 p-3 lg:block">
              <div className="mb-2 flex items-center gap-1.5">
                <Icon name="Sparkles" className="h-3.5 w-3.5 text-sky-300" />
                <span className="text-[10.5px] font-semibold text-slate-200">AI insights</span>
                <span className="relative ml-auto flex h-1.5 w-1.5 text-emerald-400">
                  <span className="mk-ping absolute inset-0 rounded-full" />
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
              </div>
              <div className="space-y-2">
                {[
                  { t: 'Meridian Health likely to close', d: '92% · quote opened 4×', tone: 'emerald' },
                  { t: 'Arden & Co going quiet', d: 'No reply in 19 days', tone: 'amber' },
                  { t: '3 follow-ups drafted', d: 'Waiting for your approval', tone: 'violet' },
                ].map((i) => (
                  <div key={i.t} className="rounded-lg border border-white/[0.07] bg-white/[0.028] p-2">
                    <div className="flex items-start gap-1.5">
                      <span
                        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                          i.tone === 'emerald' ? 'bg-emerald-400' : i.tone === 'amber' ? 'bg-amber-400' : 'bg-sky-400'
                        }`}
                      />
                      <span className="text-[10px] font-semibold leading-snug text-slate-200">{i.t}</span>
                    </div>
                    <div className="mt-1 pl-3 text-[9.5px] text-slate-500">{i.d}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.028] p-2.5">
                <div className="text-[9.5px] uppercase tracking-wider text-slate-500">Weighted forecast</div>
                <div className="mk-mono mt-1 text-[15px] font-bold text-white">$248,400</div>
                <Sparkline />
                <div className="mt-1 text-[9.5px] text-emerald-400">+18% vs last quarter</div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function Sparkline() {
  return (
    <svg viewBox="0 0 120 34" className="mt-2 h-8 w-full" aria-hidden>
      <defs>
        <linearGradient id="mk-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 28 L18 24 L34 26 L52 16 L70 19 L88 9 L104 12 L120 4 V34 H0 Z" fill="url(#mk-spark)" />
      <path
        d="M0 28 L18 24 L34 26 L52 16 L70 19 L88 9 L104 12 L120 4"
        fill="none"
        stroke="#60a5fa"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ─────────────────────────────── AI mock ───────────────────────────── */

export function AiDraftMock() {
  return (
    <MockFrame title="nucrm — ai · draft follow-up" right="Meridian Health">
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600">
            <Icon name="Sparkles" className="h-4 w-4 text-white" />
          </span>
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold text-slate-100">Drafting from 14 activities</div>
            <div className="text-[10px] text-slate-500">Tone: warm professional · Language: English</div>
          </div>
          <span className="mk-chip ml-auto hidden text-[10px] sm:inline-flex">Not sent yet</span>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5">
          <div className="mb-2 flex items-center gap-2 border-b border-white/[0.06] pb-2">
            <span className="text-[10px] text-slate-500">Subject</span>
            <span className="text-[11.5px] font-semibold text-slate-100">Next steps on the Q3 rollout</span>
          </div>
          <div className="space-y-1.5 text-[11.5px] leading-relaxed text-slate-300">
            <p>Hi Priya,</p>
            <p>
              Thanks for making time on Tuesday. You mentioned the clinic group wants the patient intake flow live before
              the September cohort — here is a shortened plan that hits that date.
            </p>
            <p>
              I have attached the revised quote with the two seats you asked about removed.
              <span className="mk-caret ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] bg-sky-400" />
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
            <span className="rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 px-2.5 py-1 text-[10.5px] font-semibold text-white">
              Approve &amp; send
            </span>
            <span className="rounded-lg border border-white/10 px-2.5 py-1 text-[10.5px] text-slate-300">Edit</span>
            <span className="rounded-lg border border-white/10 px-2.5 py-1 text-[10.5px] text-slate-300">Regenerate</span>
            <span className="mk-mono ml-auto text-[9.5px] text-slate-600">2 credits</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { l: 'Lead score', v: '92', s: 'High intent' },
            { l: 'Sentiment', v: 'Positive', s: 'Last 6 messages' },
            { l: 'Churn risk', v: 'Low', s: 'Engagement rising' },
          ].map((m) => (
            <div key={m.l} className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">{m.l}</div>
              <div className="mt-0.5 text-[13px] font-bold text-white">{m.v}</div>
              <div className="text-[9px] text-slate-500">{m.s}</div>
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}

/* ────────────────────────── automation mock ────────────────────────── */

export function AutomationMock() {
  const node = (x: number, y: number, label: string, icon: string, tone: string) => (
    <g key={label}>
      <rect x={x} y={y} width="112" height="34" rx="9" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.12)" />
      <rect x={x + 8} y={y + 9} width="16" height="16" rx="5" fill={tone} opacity="0.9" />
      <text x={x + 32} y={y + 21} fill="#dbe1ee" fontSize="9.5" fontWeight="600">
        {label}
      </text>
      <text x={x + 8} y={y + 21} fill="#0b0b16" fontSize="9" fontWeight="700">
        {icon}
      </text>
    </g>
  );

  return (
    <MockFrame title="nucrm — automation · builder" right="Deal won → onboarding">
      <div className="p-3">
        <svg viewBox="0 0 420 250" className="h-auto w-full" aria-hidden>
          {/* connectors */}
          <g fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.7">
            <path className="mk-flow" d="M76 47 C76 70 154 62 154 82" />
            <path className="mk-flow" d="M210 116 C210 138 118 132 118 152" style={{ animationDelay: '-0.4s' }} />
            <path className="mk-flow" d="M210 116 C210 138 300 132 300 152" style={{ animationDelay: '-0.8s' }} />
            <path className="mk-flow" d="M118 186 C118 208 196 202 196 218" style={{ animationDelay: '-1.1s' }} />
            <path className="mk-flow" d="M300 186 C300 208 224 202 224 218" style={{ animationDelay: '-1.4s' }} />
          </g>

          {/* trigger */}
          <g>
            <rect x="20" y="13" width="112" height="34" rx="9" fill="rgba(56,189,248,0.16)" stroke="rgba(56,189,248,0.5)" />
            <circle cx="36" cy="30" r="4" fill="#60a5fa" />
            <text x="48" y="34" fill="#dbeafe" fontSize="9.5" fontWeight="700">
              Deal marked Won
            </text>
          </g>

          {/* condition diamond */}
          <g>
            <path d="M210 78 L262 99 L210 120 L158 99 Z" fill="rgba(34,211,238,0.12)" stroke="rgba(34,211,238,0.45)" />
            <text x="210" y="96" fill="#a5f3fc" fontSize="9" fontWeight="700" textAnchor="middle">
              Value
            </text>
            <text x="210" y="107" fill="#a5f3fc" fontSize="9" fontWeight="700" textAnchor="middle">
              &gt; $50k?
            </text>
          </g>
          <text x="128" y="140" fill="#64748b" fontSize="8.5" fontWeight="600">
            YES
          </text>
          <text x="306" y="140" fill="#64748b" fontSize="8.5" fontWeight="600">
            NO
          </text>

          {node(62, 152, 'Notify #wins', '#', '#22d3ee')}
          {node(244, 152, 'Create tasks', '✓', '#f59e0b')}
          {node(140, 218, 'Generate invoice', '$', '#10b981')}
        </svg>

        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
          <span className="mk-chip text-[10px]">7 steps</span>
          <span className="mk-chip text-[10px]">2 branches</span>
          <span className="mk-chip text-[10px]">1 delay</span>
          <span className="mk-mono ml-auto text-[9.5px] text-emerald-400">1,284 runs · 0 failed</span>
        </div>
      </div>
    </MockFrame>
  );
}

/* ────────────────────────── conversation mock ──────────────────────── */

const THREAD = [
  { ch: 'Email', icon: 'Mail', tone: 'text-cyan-300 bg-cyan-500/10 border-cyan-400/25', who: 'Priya Raman', text: 'Can you send the revised quote with two fewer seats?', time: '09:14', inbound: true },
  { ch: 'WhatsApp', icon: 'MessageCircle', tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/25', who: 'You', text: 'On its way — sending the updated PDF in five minutes.', time: '09:21', inbound: false },
  { ch: 'Call', icon: 'Headphones', tone: 'text-indigo-300 bg-indigo-500/10 border-indigo-400/25', who: 'Logged by AK', text: '12 min · Walked through the rollout dates. Positive.', time: '11:02', inbound: false },
  { ch: 'Ticket', icon: 'Ticket', tone: 'text-rose-300 bg-rose-500/10 border-rose-400/25', who: 'Support', text: '#4821 resolved · SLA met in 42 minutes', time: '14:37', inbound: true },
];

export function ConversationMock() {
  return (
    <MockFrame title="nucrm — meridian health · timeline" right="Every channel, one record">
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2.5 border-b border-white/[0.06] pb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-sky-400 text-[10px] font-bold text-white">
            MH
          </span>
          <div>
            <div className="text-[12px] font-semibold text-slate-100">Meridian Health</div>
            <div className="text-[9.5px] text-slate-500">Customer · 3 open deals · $74,000 pipeline</div>
          </div>
          <span className="mk-chip ml-auto hidden text-[10px] sm:inline-flex">
            <Icon name="Sparkles" className="h-3 w-3" /> Summarise
          </span>
        </div>

        <div className="space-y-2.5">
          {THREAD.map((m) => (
            <div key={m.ch + m.time} className={`flex gap-2.5 ${m.inbound ? '' : 'flex-row-reverse'}`}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${m.tone}`}>
                <Icon name={m.icon} className="h-3 w-3" />
              </span>
              <div
                className={`max-w-[82%] rounded-xl border border-white/[0.07] bg-white/[0.028] px-3 py-2 ${
                  m.inbound ? 'rounded-tl-sm' : 'rounded-tr-sm'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-slate-200">{m.who}</span>
                  <span className={`mk-mono rounded px-1 text-[8.5px] ${m.tone}`}>{m.ch}</span>
                  <span className="mk-mono ml-auto text-[8.5px] text-slate-600">{m.time}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{m.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}

/* ─────────────────────────── analytics mock ────────────────────────── */

const BARS = [42, 58, 51, 74, 66, 88, 79, 96];
const FUNNEL = [
  { l: 'Leads', v: 100, n: '1,840' },
  { l: 'Qualified', v: 62, n: '1,141' },
  { l: 'Proposal', v: 38, n: '699' },
  { l: 'Won', v: 19, n: '350' },
];

export function AnalyticsMock() {
  return (
    <MockFrame title="nucrm — reports · revenue" right="Scheduled every Monday 07:00">
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
          <div className="text-[9.5px] uppercase tracking-wider text-slate-500">Closed revenue</div>
          <div className="mk-mono mt-0.5 text-[18px] font-bold text-white">$1.24M</div>
          <div className="mt-3 flex h-24 items-end gap-1.5">
            {BARS.map((h, i) => (
              <div
                key={i}
                className="mk-bar flex-1 rounded-t bg-gradient-to-t from-blue-600/40 to-sky-400"
                style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }}
              />
            ))}
          </div>
          <div className="mk-mono mt-1.5 flex justify-between text-[8.5px] text-slate-600">
            <span>Jan</span>
            <span>Aug</span>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
          <div className="text-[9.5px] uppercase tracking-wider text-slate-500">Conversion funnel</div>
          <div className="mt-3 space-y-2.5">
            {FUNNEL.map((f, i) => (
              <div key={f.l}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium text-slate-300">{f.l}</span>
                  <span className="mk-mono text-[10px] text-slate-400">{f.n}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className="mk-bar h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                    style={{ width: `${f.v}%`, transformOrigin: 'left', animationDelay: `${i * 110}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-white/[0.06] pt-2 text-[9.5px] text-slate-500">
            Win rate <span className="font-semibold text-emerald-400">19.0%</span> · Avg cycle 34 days
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

/* ──────────────────────────── quote mock ───────────────────────────── */

export function QuoteMock() {
  return (
    <MockFrame title="nucrm — quotes · QT-2048" right="Viewed 4 times">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
          <div>
            <div className="text-[12px] font-semibold text-slate-100">Meridian Health</div>
            <div className="mk-mono text-[9.5px] text-slate-500">QT-2048 · Valid 14 days</div>
          </div>
          <span className="rounded-md border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[9.5px] font-semibold text-amber-300">
            Awaiting signature
          </span>
        </div>

        <div className="mt-3 space-y-1.5">
          {[
            { d: 'Platform licence — 24 seats', q: '24', p: '$1,896.00' },
            { d: 'AI assistant module', q: '24', p: '$600.00' },
            { d: 'Onboarding & migration', q: '1', p: '$2,400.00' },
          ].map((l) => (
            <div key={l.d} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-300">{l.d}</span>
              <span className="mk-mono text-[9.5px] text-slate-500">×{l.q}</span>
              <span className="mk-mono text-[10.5px] text-slate-200">{l.p}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
          {[
            ['Subtotal', '$4,896.00'],
            ['Tax (20%)', '$979.20'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-[10px] text-slate-500">
              <span>{k}</span>
              <span className="mk-mono">{v}</span>
            </div>
          ))}
          <div className="flex justify-between pt-1 text-[13px] font-bold text-white">
            <span>Total</span>
            <span className="mk-mono">$5,875.20</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 px-2.5 py-1 text-[10.5px] font-semibold text-white">
            Send for signature
          </span>
          <span className="rounded-lg border border-white/10 px-2.5 py-1 text-[10.5px] text-slate-300">Download PDF</span>
          <span className="mk-mono ml-auto text-[9.5px] text-slate-600">Public link active</span>
        </div>
      </div>
    </MockFrame>
  );
}

/* ──────────────────────────── ticket mock ──────────────────────────── */

export function TicketMock() {
  return (
    <MockFrame title="nucrm — tickets · #4821" right="SLA 42m of 60m">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/25 bg-rose-500/10">
            <Icon name="Ticket" className="h-4 w-4 text-rose-300" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-slate-100">Intake form not saving on mobile</div>
            <div className="mk-mono mt-0.5 text-[9.5px] text-slate-500">Meridian Health · High · Assigned to Sam</div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9.5px] uppercase tracking-wider text-slate-500">First response SLA</span>
            <span className="mk-mono text-[10px] text-emerald-400">Met · 42m</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="mk-bar h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" style={{ width: '70%', transformOrigin: 'left' }} />
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <div className="text-[9.5px] font-semibold text-slate-400">Internal note · not visible to customer</div>
            <p className="mt-1 text-[10.5px] text-slate-300">Reproduced on small screens. Fix shipping today.</p>
          </div>
          <div className="rounded-lg border border-sky-400/20 bg-sky-500/[0.07] p-2.5">
            <div className="flex items-center gap-1.5">
              <Icon name="Sparkles" className="h-3 w-3 text-sky-300" />
              <span className="text-[9.5px] font-semibold text-sky-200">Suggested reply from knowledge base</span>
            </div>
            <p className="mt-1 text-[10.5px] text-slate-300">
              “Clearing the saved form draft resolves this while the fix rolls out…”
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3">
          <span className="rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 px-2.5 py-1 text-[10.5px] font-semibold text-white">
            Resolve &amp; send CSAT
          </span>
          <span className="mk-mono ml-auto text-[9.5px] text-slate-600">Portal visible</span>
        </div>
      </div>
    </MockFrame>
  );
}


/* ───────────────────────── governance mock ─────────────────────────── */

const ROLES: { role: string; scope: string; marks: (boolean | 'part')[] }[] = [
  { role: 'Admin', scope: 'Workspace', marks: [true, true, true, true] },
  { role: 'Sales manager', scope: 'Own team', marks: [true, true, true, false] },
  { role: 'Sales rep', scope: 'Own records', marks: [true, true, false, false] },
  { role: 'Finance', scope: 'Billing only', marks: ['part', false, true, false] },
  { role: 'Viewer', scope: 'Read only', marks: [true, false, false, false] },
];

/**
 * Permission matrix plus audit trail — the two screens a security reviewer
 * asks to see before anything else.
 */
export function GovernanceMock() {
  const mark = (m: boolean | 'part') =>
    m === true ? (
      <Icon name="Check" className="mx-auto h-3.5 w-3.5 text-emerald-400" strokeWidth={2.6} />
    ) : m === 'part' ? (
      <span className="mk-mono text-[9px] text-amber-300">FIELD</span>
    ) : (
      <span className="text-slate-700">—</span>
    );

  return (
    <MockFrame title="nucrm — settings · roles &amp; audit" right="Acme Group">
      <div className="p-4">
        <div className="overflow-hidden rounded-xl border border-white/[0.07]">
          <table className="w-full">
            <thead>
              <tr className="bg-white/[0.03]">
                {['Role', 'Scope', 'View', 'Edit', 'Billing', 'Export'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-2.5 py-2 text-[9px] uppercase tracking-wider text-slate-500 ${i > 1 ? 'text-center' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.role} className="border-t border-white/[0.05]">
                  <td className="px-2.5 py-2 text-[11px] font-semibold text-slate-200">{r.role}</td>
                  <td className="px-2.5 py-2 text-[10px] text-slate-500">{r.scope}</td>
                  {r.marks.map((m, i) => (
                    <td key={i} className="px-2.5 py-2 text-center">
                      {mark(m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Icon name="ScrollText" className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[10.5px] font-semibold text-slate-200">Audit trail</span>
            <span className="mk-mono ml-auto text-[9px] text-slate-600">immutable</span>
          </div>
          <div className="space-y-1.5">
            {[
              ['09:41', 'a.kaur', 'Deal “Meridian Health” value $68,000 → $74,000'],
              ['09:12', 'system', 'Assignment rule routed lead #8842 to m.rivera'],
              ['08:57', 'admin', 'Role “Finance” granted export on invoices'],
              ['08:31', 'j.patel', 'Contact merged: 2 duplicates resolved'],
            ].map(([t, who, what]) => (
              <div key={t} className="flex items-start gap-2 text-[10px]">
                <span className="mk-mono shrink-0 text-slate-600">{t}</span>
                <span className="mk-mono shrink-0 text-sky-300">{who}</span>
                <span className="min-w-0 truncate text-slate-400">{what}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { l: 'Workspaces', v: '4', s: 'Isolated' },
            { l: 'Last backup', v: '2h ago', s: 'Restore tested' },
            { l: 'Sessions', v: '18', s: 'Revocable' },
          ].map((m) => (
            <div key={m.l} className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">{m.l}</div>
              <div className="mt-0.5 text-[13px] font-bold text-white">{m.v}</div>
              <div className="text-[9px] text-slate-500">{m.s}</div>
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}
