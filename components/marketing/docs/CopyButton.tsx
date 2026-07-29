'use client';

import { useState, useRef, type ReactNode } from 'react';

/**
 * Code block wrapper with a copy button. Client component because it uses
 * useState for the "copied" feedback and a ref to read the text content.
 */
export function CodeBlock({ children }: { children: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = preRef.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available in some contexts
    }
  };

  return (
    <div className="group relative my-5 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0d1a]">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-slate-400 opacity-100 transition-opacity hover:bg-white/[0.08] hover:text-white focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre
        ref={preRef}
        className="overflow-x-auto p-4 text-[13px] leading-relaxed text-slate-300"
        style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      >
        {children}
      </pre>
    </div>
  );
}
