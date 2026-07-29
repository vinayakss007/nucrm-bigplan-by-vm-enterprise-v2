'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getPublishedSections, type DocSection } from '@/lib/marketing/docs';
import { Icon } from '@/components/marketing/icon';

/* ─────────────────────────── Types ─────────────────────────────────── */

interface SearchResult {
  title: string;
  sectionTitle: string;
  sectionIcon: string;
  description: string;
  href: string;
  /** Lower = better rank (0 = exact title, 1 = title contains, 2 = description/section) */
  rank: number;
}

/* ─────────────────────────── Search index ──────────────────────────── */

interface IndexEntry {
  title: string;
  titleLower: string;
  sectionTitle: string;
  sectionTitleLower: string;
  sectionIcon: string;
  description: string;
  descriptionLower: string;
  href: string;
}

function buildIndex(sections: DocSection[]): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const section of sections) {
    for (const article of section.articles) {
      entries.push({
        title: article.title,
        titleLower: article.title.toLowerCase(),
        sectionTitle: section.title,
        sectionTitleLower: section.title.toLowerCase(),
        sectionIcon: section.icon,
        description: section.description,
        descriptionLower: section.description.toLowerCase(),
        href: `/docs/${section.slug}/${article.slug}`,
      });
    }
  }
  return entries;
}

/* ─────────────────────────── Search logic ──────────────────────────── */

/**
 * Basic fuzzy match: checks whether all characters in the query appear in the
 * text in order, allowing characters to be skipped between matches.
 */
function fuzzyMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

function search(index: IndexEntry[], query: string, limit = 12): SearchResult[] {
  if (query.length < 2) return [];
  const q = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  for (const entry of index) {
    let rank = -1;

    // Rank 0: Exact title match
    if (entry.titleLower === q) {
      rank = 0;
    }
    // Rank 1: Title starts with the query
    else if (entry.titleLower.startsWith(q)) {
      rank = 1;
    }
    // Rank 2: Title contains the query
    else if (entry.titleLower.includes(q)) {
      rank = 2;
    }
    // Rank 3: Section title contains the query
    else if (entry.sectionTitleLower.includes(q)) {
      rank = 3;
    }
    // Rank 4: Description contains the query
    else if (entry.descriptionLower.includes(q)) {
      rank = 4;
    }
    // Rank 5: Fuzzy match on title
    else if (fuzzyMatch(entry.titleLower, q)) {
      rank = 5;
    }

    if (rank >= 0) {
      results.push({
        title: entry.title,
        sectionTitle: entry.sectionTitle,
        sectionIcon: entry.sectionIcon,
        description: entry.description,
        href: entry.href,
        rank,
      });
    }
  }

  // Sort by rank, then alphabetically within same rank
  results.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.title.localeCompare(b.title);
  });

  return results.slice(0, limit);
}

/* ─────────────────────────── Debounce hook ─────────────────────────── */

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/* ─────────────────────────── Component ─────────────────────────────── */

export function DocsSearch({ className = '' }: { className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 150);

  // Build search index once (only published sections)
  const index = useMemo(() => buildIndex(getPublishedSections()), []);

  // Compute results from debounced query
  const results = useMemo(() => search(index, debouncedQuery), [index, debouncedQuery]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

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

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, []);

  // Navigate to a result
  const navigateTo = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery('');
      setActiveIndex(-1);
      router.push(href);
    },
    [router],
  );

  // Keyboard navigation inside search
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open || results.length === 0) {
        if (e.key === 'Escape') {
          setOpen(false);
          inputRef.current?.blur();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = activeIndex < results.length - 1 ? activeIndex + 1 : 0;
          setActiveIndex(next);
          // Scroll into view
          const el = resultsRef.current?.querySelector(`[data-index="${next}"]`);
          el?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = activeIndex > 0 ? activeIndex - 1 : results.length - 1;
          setActiveIndex(prev);
          const el = resultsRef.current?.querySelector(`[data-index="${prev}"]`);
          el?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < results.length) {
            navigateTo(results[activeIndex]!.href);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setOpen(false);
          inputRef.current?.blur();
          break;
        }
      }
    },
    [open, results, activeIndex, navigateTo],
  );

  // Highlight matching substring in text
  const highlightMatch = useCallback(
    (text: string) => {
      if (!debouncedQuery || debouncedQuery.length < 2) return text;
      const q = debouncedQuery.toLowerCase();
      const idx = text.toLowerCase().indexOf(q);
      if (idx === -1) return text;
      return (
        <>
          {text.slice(0, idx)}
          <span className="text-violet-400">{text.slice(idx, idx + debouncedQuery.length)}</span>
          {text.slice(idx + debouncedQuery.length)}
        </>
      );
    },
    [debouncedQuery],
  );

  // Detect platform for shortcut hint (deferred to avoid hydration mismatch)
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7488]"
        />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search docs..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="mk-search-input w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2.5 pl-10 pr-16 text-[13px] text-white placeholder-[#6b7488] outline-none transition-colors focus:border-violet-500/40 focus:bg-white/[0.05]"
          aria-label="Search documentation"
          aria-expanded={open && results.length > 0}
          aria-controls="docs-search-results"
          role="combobox"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `docs-search-result-${activeIndex}` : undefined}
        />
        {/* Keyboard shortcut hint */}
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-[#6b7488]">
          {isMac ? '\u2318' : 'Ctrl'}K
        </kbd>
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <div
          ref={resultsRef}
          id="docs-search-results"
          role="listbox"
          className="docs-search-results absolute left-0 right-0 top-full z-50 mt-2 max-h-[380px] overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0d0d1a] p-2 shadow-2xl"
        >
          {results.map((r, i) => (
            <Link
              key={r.href}
              href={r.href}
              data-index={i}
              id={`docs-search-result-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => {
                setOpen(false);
                setQuery('');
                setActiveIndex(-1);
              }}
              className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                i === activeIndex
                  ? 'bg-violet-500/10 border border-violet-500/20'
                  : 'border border-transparent hover:bg-white/[0.05]'
              }`}
            >
              <Icon
                name={r.sectionIcon}
                className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                  i === activeIndex ? 'text-violet-400' : 'text-[#6b7488]'
                }`}
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white">
                  {highlightMatch(r.title)}
                </span>
                <span className="block truncate text-[11px] text-[#6b7488]">
                  {r.sectionTitle}
                </span>
              </div>
              {i === activeIndex && (
                <Icon name="ArrowRight" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-400" />
              )}
            </Link>
          ))}
        </div>
      )}

      {/* No results state */}
      {open && debouncedQuery.trim().length > 1 && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-white/[0.1] bg-[#0d0d1a] p-5 text-center shadow-2xl">
          <Icon name="Search" className="mx-auto mb-2 h-5 w-5 text-[#6b7488]" />
          <p className="text-[13px] text-[#6b7488]">
            No results for &ldquo;{debouncedQuery}&rdquo;
          </p>
          <p className="mt-1 text-[11px] text-[#6b7488]/60">
            Try a different keyword or browse the sidebar
          </p>
        </div>
      )}
    </div>
  );
}
