'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { MDXProvider } from '@mdx-js/react';
import { docsComponents } from './mdx-components';

interface MDXContentProps {
  sectionSlug: string;
  articleSlug: string;
}

/**
 * Client component that dynamically loads and renders MDX content.
 * Uses dynamic import to resolve the correct article based on slug segments.
 */
export function MDXContent({ sectionSlug, articleSlug }: MDXContentProps) {
  const [Content, setContent] = useState<ComponentType | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setContent(null);
    setError(false);

    import(`@/content/docs/${sectionSlug}/${articleSlug}.mdx`)
      .then((mod) => {
        setContent(() => mod.default);
      })
      .catch(() => {
        setError(true);
      });
  }, [sectionSlug, articleSlug]);

  if (error) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-8 text-center">
        <p className="text-[15px] text-[#9aa4b8]">
          This article is coming soon. Check back later for the full content.
        </p>
      </div>
    );
  }

  if (!Content) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-4 w-3/4 rounded bg-white/[0.05]" />
        <div className="h-4 w-full rounded bg-white/[0.05]" />
        <div className="h-4 w-5/6 rounded bg-white/[0.05]" />
        <div className="h-4 w-2/3 rounded bg-white/[0.05]" />
      </div>
    );
  }

  return (
    <MDXProvider components={docsComponents}>
      <Content />
    </MDXProvider>
  );
}
