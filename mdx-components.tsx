import type { MDXComponents } from 'mdx/types';
import { docsComponents } from '@/components/marketing/docs/mdx-components';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    ...docsComponents,
  };
}
