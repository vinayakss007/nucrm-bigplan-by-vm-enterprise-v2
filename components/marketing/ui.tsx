/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './icon';
import { Reveal } from './reveal';

/* ─────────────────────────── Layout shells ─────────────────────────── */

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1200px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Section({
  children,
  className = '',
  id,
  tone = 'plain',
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  /** `soft` adds a faint lifted panel behind the section to break up long pages. */
  tone?: 'plain' | 'soft';
}) {
  return (
    <section
      id={id}
      className={`relative py-16 sm:py-24 ${tone === 'soft' ? 'bg-white/[0.015] border-y border-white/[0.06]' : ''} ${className}`}
    >
      {children}
    </section>
  );
}

/** Slow-moving colour wash used behind hero areas. */
export function Aurora({
  className = '',
  intensity = 1,
}: {
  className?: string;
  intensity?: number;
}) {
  return (
    <div className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`} aria-hidden>
      <div
        className="mk-aurora absolute -top-40 left-[6%] h-[520px] w-[520px] rounded-full blur-[130px]"
        style={{ background: `rgba(37,99,235,${0.4 * intensity})` }}
      />
      <div
        className="mk-aurora absolute -top-24 right-[4%] h-[460px] w-[460px] rounded-full blur-[130px]"
        style={{ background: `rgba(56,189,248,${0.34 * intensity})`, animationDelay: '-9s' }}
      />
      <div
        className="mk-aurora absolute top-[38%] left-[38%] h-[420px] w-[420px] rounded-full blur-[140px]"
        style={{ background: `rgba(224,242,254,${0.22 * intensity})`, animationDelay: '-17s' }}
      />
      <div className="mk-grid-bg mk-fade-y absolute inset-0" />
    </div>
  );
}

/* ─────────────────────────── Typography bits ────────────────────────── */

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`mk-eyebrow inline-flex items-center gap-2 text-sky-300/90 ${className}`}>
      <span className="h-[5px] w-[5px] rounded-full bg-sky-400" />
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
  align = 'center',
  className = '',
}: {
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  align?: 'center' | 'left';
  className?: string;
}) {
  const wrap = align === 'center' ? 'text-center mx-auto max-w-2xl' : 'max-w-2xl';
  return (
    <Reveal className={`${wrap} ${className}`}>
      {eyebrow && <Eyebrow className="mb-4">{eyebrow}</Eyebrow>}
      <h2 className="mk-h2 text-white">{title}</h2>
      {sub && <p className="mk-lead mt-4">{sub}</p>}
    </Reveal>
  );
}

/** Small capability tag. */
export function Chip({ children, icon }: { children: ReactNode; icon?: string }) {
  return (
    <span className="mk-chip">
      {icon && <Icon name={icon} className="h-3.5 w-3.5 text-sky-300" />}
      {children}
    </span>
  );
}

export function IconTile({
  name,
  accent = 'from-blue-500 to-sky-400',
  size = 'md',
}: {
  name: string;
  accent?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dim = size === 'lg' ? 'h-14 w-14 rounded-2xl' : size === 'sm' ? 'h-9 w-9 rounded-[10px]' : 'h-11 w-11 rounded-xl';
  const ico = size === 'lg' ? 'h-7 w-7' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center bg-gradient-to-br ${accent} ${dim} shadow-lg shadow-black/40 ring-1 ring-inset ring-white/20`}
    >
      <Icon name={name} className={`${ico} text-white`} strokeWidth={1.8} />
    </span>
  );
}

/* ───────────────────────────── Lists ───────────────────────────────── */

export function CheckList({
  items,
  className = '',
  tone = 'violet',
}: {
  items: readonly string[];
  className?: string;
  tone?: 'violet' | 'emerald';
}) {
  const color = tone === 'emerald' ? 'text-emerald-400' : 'text-sky-400';
  return (
    <ul className={`space-y-2.5 ${className}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <Icon name="Check" className={`mt-[3px] h-4 w-4 shrink-0 ${color}`} strokeWidth={2.4} />
          <span className="mk-body text-slate-300">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── Buttons ─────────────────────────────── */

export function PrimaryCta({
  href = '/auth/signup',
  children = 'Start free',
  className = '',
}: {
  href?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`mk-btn mk-btn-primary group ${className}`}>
      {children}
      <Icon name="ArrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.2} />
    </Link>
  );
}

export function GhostCta({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`mk-btn mk-btn-ghost ${className}`}>
      {children}
    </Link>
  );
}

/** Text link with the growing underline. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mk-link group inline-flex items-center gap-1.5 text-sm">
      {children}
      <Icon name="ArrowUpRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.2} />
    </Link>
  );
}

/* ────────────────────────── Composite blocks ───────────────────────── */

/** The standard hero used by every page except the landing page. */
export function PageHero({
  eyebrow,
  title,
  sub,
  children,
  breadcrumb,
}: {
  eyebrow: string;
  title: ReactNode;
  sub: ReactNode;
  children?: ReactNode;
  breadcrumb?: { label: string; href: string }[];
}) {
  return (
    <header className="relative overflow-hidden pt-32 pb-14 sm:pt-40 sm:pb-20">
      <Aurora intensity={0.75} />
      <Container>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="mk-tiny mb-6 flex flex-wrap items-center gap-1.5" aria-label="Breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={b.href} className="flex items-center gap-1.5">
                {i > 0 && <Icon name="ChevronRight" className="h-3 w-3 text-slate-600" />}
                <Link href={b.href} className="transition-colors hover:text-sky-300">
                  {b.label}
                </Link>
              </span>
            ))}
          </nav>
        )}
        <Reveal>
          <Eyebrow className="mb-5">{eyebrow}</Eyebrow>
          <h1 className="mk-h1 max-w-3xl text-white">{title}</h1>
          <p className="mk-lead mt-5 max-w-2xl">{sub}</p>
        </Reveal>
        {children && <Reveal delay={90}>{children}</Reveal>}
      </Container>
    </header>
  );
}

/** Closing conversion band. Appears at the bottom of every page. */
export function CtaBand({
  title = 'Bring the whole revenue operation into one place',
  sub = 'Start free, invite the team, and see how much of your tool stack you can retire. No card required, no sales call unless you want one.',
  primary = { label: 'Start free', href: '/auth/signup' },
  secondary = { label: 'Talk to sales', href: '/contact' },
}: {
  title?: string;
  sub?: string;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#1d4ed8_0%,#0284c7_50%,#0e7490_100%)] opacity-95" />
        <div className="mk-grid-bg absolute inset-0 opacity-60" />
        <div className="mk-aurora absolute -top-24 left-1/4 h-80 w-80 rounded-full bg-white/15 blur-[110px]" />
        <div className="mk-aurora absolute -bottom-20 right-1/5 h-80 w-80 rounded-full bg-cyan-300/20 blur-[110px]" style={{ animationDelay: '-11s' }} />
      </div>
      <Container className="text-center">
        <Reveal>
          <h2 className="mk-h2 mx-auto max-w-2xl text-white">{title}</h2>
          <p className="mk-lead mx-auto mt-4 max-w-xl text-white/75">{sub}</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={primary.href} className="mk-btn mk-btn-light group w-full sm:w-auto">
              {primary.label}
              <Icon name="ArrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.2} />
            </Link>
            <Link href={secondary.href} className="mk-btn mk-btn-ghost w-full border-white/25 bg-white/10 text-white sm:w-auto">
              {secondary.label}
            </Link>
          </div>
          <p className="mk-tiny mt-6 text-white/60">Free plan forever · Import your data in an afternoon · Cancel any time</p>
        </Reveal>
      </Container>
    </section>
  );
}

/** Infinite horizontal rail. Children are rendered twice for a seamless loop. */
export function Marquee({
  children,
  reverse = false,
  className = '',
}: {
  children: ReactNode;
  reverse?: boolean;
  className?: string;
}) {
  return (
    <div className={`mk-marquee mk-fade-x overflow-hidden ${className}`}>
      <div className={`mk-marquee-track ${reverse ? 'reverse' : ''}`}>
        <div className="flex shrink-0 items-center gap-3 pr-3">{children}</div>
        <div className="flex shrink-0 items-center gap-3 pr-3" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Renders a matrix cell value: true/false become marks, strings stay text. */
export function MatrixValue({ value, own = false }: { value: boolean | string; own?: boolean }) {
  if (value === true) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${own ? 'text-sky-200' : 'text-emerald-400'}`}>
        <Icon name="Check" className="h-4 w-4" strokeWidth={2.6} />
        <span className="sr-only">Included</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="text-sm text-slate-600">
        —<span className="sr-only">Not available</span>
      </span>
    );
  }
  return <span className={`text-sm ${own ? 'font-semibold text-sky-200' : 'text-slate-400'}`}>{value}</span>;
}

/** Numbered step used on migration and how-it-works sections. */
export function StepRow({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="mk-mono mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-500/10 font-semibold text-sky-300">
        {n}
      </span>
      <span className="mk-body text-slate-300">{children}</span>
    </li>
  );
}
