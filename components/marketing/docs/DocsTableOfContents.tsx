'use client';

import { useEffect, useRef, useState } from 'react';

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

/**
 * Right-side sticky table of contents that uses IntersectionObserver
 * to highlight the heading currently in view.
 */
export function DocsTableOfContents({ className = '' }: { className?: string }) {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    // Collect all h2 and h3 elements from the docs prose area
    const elements = Array.from(
      document.querySelectorAll('.docs-prose h2[id], .docs-prose h3[id]'),
    );
    const items: TocHeading[] = elements.map((el) => ({
      id: el.id,
      text: el.textContent ?? '',
      level: el.tagName === 'H2' ? 2 : 3,
    }));
    setHeadings(items);

    // Observe heading visibility
    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Find the first heading that is intersecting
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0 && visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 },
    );

    elements.forEach((el) => observerRef.current?.observe(el));

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="Table of contents" className={className}>
      <div className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-[#6b7488] mb-3">
        On this page
      </div>
      <ul className="space-y-1">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`block rounded-md py-1 text-[13px] transition-colors ${
                h.level === 3 ? 'pl-4' : 'pl-2'
              } ${
                activeId === h.id
                  ? 'text-violet-300 font-medium'
                  : 'text-[#9aa4b8] hover:text-white'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
