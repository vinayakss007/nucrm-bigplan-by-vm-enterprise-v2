'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { DOC_SECTIONS } from '@/lib/marketing/docs';
import { Icon } from '@/components/marketing/icon';

interface SearchResult {
  title: string;
  sectionTitle: string;
  href: string;
}

export function DocsSearch({ className = '' }: { className?: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const results: SearchResult[] = [];
  if (query.trim().length > 1) {
    const q = query.toLowerCase();
    for (const section of DOC_SECTIONS) {
      for (const article of section.articles) {
        if (article.title.toLowerCase().includes(q) || section.title.toLowerCase().includes(q)) {
          results.push({
            title: article.title,
            sectionTitle: section.title,
            href: `/docs/${section.slug}/${article.slug}`,
          });
        }
        if (results.length >= 12) break;
      }
      if (results.length >= 12) break;
    }
  }

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7488]"
        />
        <input
          type="text"
          placeholder="Search documentation..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2.5 pl-10 pr-4 text-[13px] text-white placeholder-[#6b7488] outline-none transition-colors focus:border-violet-500/40 focus:bg-white/[0.05]"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0d0d1a] p-2 shadow-2xl">
          {results.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              onClick={() => {
                setOpen(false);
                setQuery('');
              }}
              className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.05]"
            >
              <span className="text-[13px] font-medium text-white">{r.title}</span>
              <span className="text-[11px] text-[#6b7488]">{r.sectionTitle}</span>
            </Link>
          ))}
        </div>
      )}
      {open && query.trim().length > 1 && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-white/[0.1] bg-[#0d0d1a] p-4 text-center text-[13px] text-[#6b7488] shadow-2xl">
          No results found for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}
