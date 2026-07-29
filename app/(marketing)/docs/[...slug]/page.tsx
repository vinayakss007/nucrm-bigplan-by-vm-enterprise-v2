import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MDXContent } from '@/components/marketing/docs/MDXContent';
import { DocsBreadcrumb } from '@/components/marketing/docs/DocsBreadcrumb';
import { DocsPrevNext } from '@/components/marketing/docs/DocsPrevNext';
import {
  getSection,
  getBreadcrumbs,
  getPrevNext,
  getPublishedSections,
  isArticlePublished,
} from '@/lib/marketing/docs';

/* ─────────────── Params ─────────────── */

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

/* ─────────────── Metadata generation ─────────────── */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [sectionSlug, articleSlug] = slug;

  if (!sectionSlug || !articleSlug) return { title: 'Documentation - NuCRM' };

  const section = getSection(sectionSlug);
  if (!section) return { title: 'Documentation - NuCRM' };

  const article = section.articles.find((a) => a.slug === articleSlug);
  if (!article) return { title: 'Documentation - NuCRM' };

  return {
    title: `${article.title} - ${section.title} - NuCRM Docs`,
    description: `Learn how to ${article.title.toLowerCase()} in NuCRM. ${section.description}`,
  };
}

/* ─────────────── Static params for pre-rendering ─────────────── */

export function generateStaticParams() {
  const params: { slug: string[] }[] = [];
  const sections = getPublishedSections();
  for (const section of sections) {
    for (const article of section.articles) {
      params.push({ slug: [section.slug, article.slug] });
    }
  }
  return params;
}

/* ─────────────── Server-side MDX loader ─────────────── */

import fs from 'node:fs';
import path from 'node:path';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { docsComponents as mdxComponents } from '@/components/marketing/docs/mdx-components';

function loadMDXSource(sectionSlug: string, articleSlug: string): string | null {
  const filePath = path.join(process.cwd(), 'content', 'docs', sectionSlug, `${articleSlug}.mdx`);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/* ─────────────── Page component ─────────────── */

export default async function DocsArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const [sectionSlug, articleSlug] = slug;

  if (!sectionSlug || !articleSlug) notFound();

  const section = getSection(sectionSlug);
  if (!section) notFound();

  const article = section.articles.find((a) => a.slug === articleSlug);
  if (!article) notFound();

  // Only serve published articles
  if (!isArticlePublished(sectionSlug, articleSlug)) notFound();

  const breadcrumbs = getBreadcrumbs(sectionSlug, articleSlug);
  const prevNext = getPrevNext(sectionSlug, articleSlug);

  // Load raw MDX source and render via MDXRemote (server component)
  const source = loadMDXSource(sectionSlug, articleSlug);

  return (
    <article>
      <DocsBreadcrumb items={breadcrumbs} />
      <h1 className="mb-6 text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-white">
        {article.title}
      </h1>
      {source ? (
        <MDXContent>
          <MDXRemote
            source={source}
            options={{
              mdxOptions: {
                remarkPlugins: [remarkGfm],
                rehypePlugins: [rehypeSlug],
              },
            }}
            components={mdxComponents}
          />
        </MDXContent>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-8 text-center">
          <p className="text-[15px] text-[#9aa4b8]">
            This article is coming soon. Check back later for the full content.
          </p>
        </div>
      )}
      <DocsPrevNext prev={prevNext.prev} next={prevNext.next} />
    </article>
  );
}
