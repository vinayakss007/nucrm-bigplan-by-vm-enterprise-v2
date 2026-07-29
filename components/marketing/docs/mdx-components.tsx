'use client';

import type { ReactNode } from 'react';
import { useState, useRef } from 'react';
import { Icon } from '@/components/marketing/icon';

/**
 * MDX component overrides for the public documentation.
 * All typography uses px-based sizes (immune to 125% root font-size).
 * Integrates with rehype-slug anchor links automatically.
 */

/* ─────────────── Headings with anchor links ─────────────── */

function HeadingLink({ id, children: _children }: { id?: string; children?: ReactNode }) {
  if (!id) return null;
  return (
    <a
      href={`#${id}`}
      className="ml-2 opacity-0 transition-opacity group-hover:opacity-100"
      aria-label="Link to this section"
    >
      <Icon name="Link" className="inline h-4 w-4 text-violet-400/60" />
    </a>
  );
}

function H2({ id, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      id={id}
      className="group mt-10 mb-4 text-[21px] font-bold leading-[1.25] tracking-[-0.02em] text-white scroll-mt-[90px]"
      {...props}
    >
      {children}
      <HeadingLink id={id}>{children}</HeadingLink>
    </h2>
  );
}

function H3({ id, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      id={id}
      className="group mt-8 mb-3 text-[16px] font-bold leading-[1.35] text-[#e2e8f2] scroll-mt-[90px]"
      {...props}
    >
      {children}
      <HeadingLink id={id}>{children}</HeadingLink>
    </h3>
  );
}

function H4({ id, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h4
      id={id}
      className="group mt-6 mb-2 text-[14.5px] font-bold leading-[1.4] text-[#e2e8f2] scroll-mt-[90px]"
      {...props}
    >
      {children}
      <HeadingLink id={id}>{children}</HeadingLink>
    </h4>
  );
}

/* ─────────────── Text elements ─────────────── */

function P({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className="mb-4 text-[15px] font-normal leading-[1.75] text-[#9aa4b8]" {...props}>
      {children}
    </p>
  );
}

function Strong({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <strong className="font-semibold text-[#e8ecf5]" {...props}>
      {children}
    </strong>
  );
}

function Anchor({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      className="text-[#c4b5fd] underline underline-offset-2 transition-colors hover:text-violet-300"
      {...props}
    >
      {children}
    </a>
  );
}

/* ─────────────── Lists ─────────────── */

function Ul({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className="mb-5 space-y-2 pl-0 list-none" {...props}>
      {children}
    </ul>
  );
}

function Ol({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) {
  return (
    <ol className="mb-5 space-y-2 pl-6 list-decimal marker:text-violet-400/70" {...props}>
      {children}
    </ol>
  );
}

function Li({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      className="relative pl-5 text-[15px] leading-[1.75] text-[#9aa4b8] before:absolute before:left-0 before:top-[0.72em] before:h-[5px] before:w-[5px] before:rounded-full before:bg-violet-400/70"
      {...props}
    >
      {children}
    </li>
  );
}

/* ─────────────── Code ─────────────── */

function Pre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);

  return (
    <div className="group relative mb-5">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0a0a16] px-5 py-4 text-[13px] leading-[1.7]"
        {...props}
      >
        {children}
      </pre>
      <CopyButton getTextRef={preRef} />
    </div>
  );
}

function Code({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  // If inside a pre (has className from rehype-pretty-code), render plain
  if (className) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  // Inline code
  return (
    <code
      className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[13px] font-medium text-violet-200"
      {...props}
    >
      {children}
    </code>
  );
}

function CopyButton({ getTextRef }: { getTextRef: React.RefObject<HTMLPreElement | null> }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      const text = getTextRef.current?.textContent ?? '';
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute right-3 top-3 rounded-md border border-white/[0.1] bg-[#0d0d1a] p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
      aria-label="Copy code"
    >
      <Icon
        name={copied ? 'Check' : 'Copy'}
        className={`h-3.5 w-3.5 ${copied ? 'text-emerald-400' : 'text-[#6b7488]'}`}
      />
    </button>
  );
}

/* ─────────────── Tables ─────────────── */

function Table({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="mb-5 overflow-x-auto rounded-xl border border-white/[0.08]">
      <table className="w-full text-[14px] border-collapse" {...props}>
        {children}
      </table>
    </div>
  );
}

function Th({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className="border-b border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left text-[12.5px] font-bold text-[#e2e8f2]"
      {...props}
    >
      {children}
    </th>
  );
}

function Td({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className="border-b border-white/[0.06] px-4 py-3 text-[14px] text-[#9aa4b8]"
      {...props}
    >
      {children}
    </td>
  );
}

/* ─────────────── Blockquote (used as note) ─────────────── */

function Blockquote({ children, ...props }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) {
  return (
    <blockquote
      className="mb-5 rounded-xl border-l-4 border-violet-500/50 bg-violet-500/[0.05] px-5 py-4 text-[14px] text-[#9aa4b8]"
      {...props}
    >
      {children}
    </blockquote>
  );
}

/* ─────────────── Callout components ─────────────── */

type CalloutVariant = 'tip' | 'warning' | 'note' | 'info';

const CALLOUT_STYLES: Record<CalloutVariant, { border: string; bg: string; icon: string; iconColor: string; label: string }> = {
  tip: { border: 'border-emerald-500/50', bg: 'bg-emerald-500/[0.05]', icon: 'Lightbulb', iconColor: 'text-emerald-400', label: 'Tip' },
  warning: { border: 'border-amber-500/50', bg: 'bg-amber-500/[0.05]', icon: 'AlertTriangle', iconColor: 'text-amber-400', label: 'Warning' },
  note: { border: 'border-blue-500/50', bg: 'bg-blue-500/[0.05]', icon: 'Info', iconColor: 'text-blue-400', label: 'Note' },
  info: { border: 'border-violet-500/50', bg: 'bg-violet-500/[0.05]', icon: 'Info', iconColor: 'text-violet-400', label: 'Info' },
};

export function Callout({ variant = 'note', children }: { variant?: CalloutVariant; children: ReactNode }) {
  const style = CALLOUT_STYLES[variant];
  return (
    <div className={`mb-5 rounded-xl border-l-4 ${style.border} ${style.bg} px-5 py-4`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon name={style.icon} className={`h-4 w-4 ${style.iconColor}`} />
        <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-white/70">{style.label}</span>
      </div>
      <div className="text-[14px] leading-[1.7] text-[#9aa4b8]">{children}</div>
    </div>
  );
}

/* ─────────────── Step component ─────────────── */

export function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="mb-4 flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-400/30 bg-violet-500/10 text-[12px] font-bold text-violet-300">
        {n}
      </span>
      <div className="flex-1 text-[15px] leading-[1.75] text-[#9aa4b8] pt-0.5">{children}</div>
    </div>
  );
}

/* ─────────────── Horizontal rule ─────────────── */

function Hr(props: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className="my-8 border-t border-white/[0.08]" {...props} />;
}

/* ─────────────── Exports ─────────────── */

export const docsComponents = {
  h2: H2,
  h3: H3,
  h4: H4,
  p: P,
  strong: Strong,
  a: Anchor,
  ul: Ul,
  ol: Ol,
  li: Li,
  pre: Pre,
  code: Code,
  table: Table,
  th: Th,
  td: Td,
  blockquote: Blockquote,
  hr: Hr,
  Callout,
  Step,
};
