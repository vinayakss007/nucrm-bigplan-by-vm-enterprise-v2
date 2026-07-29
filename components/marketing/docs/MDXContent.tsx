import type { ReactNode } from 'react';

interface MDXContentProps {
  children: ReactNode;
}

/**
 * Wrapper for server-rendered MDX content.
 * Content is imported at the server level in page.tsx and passed as children.
 * The parent layout already provides the docs-prose class for TOC scanning.
 */
export function MDXContent({ children }: MDXContentProps) {
  return <>{children}</>;
}
