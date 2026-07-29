import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MDXContent } from '@/components/marketing/docs/MDXContent';
import { DocsBreadcrumb } from '@/components/marketing/docs/DocsBreadcrumb';
import { DocsPrevNext } from '@/components/marketing/docs/DocsPrevNext';
import {
  getSection,
  getBreadcrumbs,
  getPrevNext,
  DOC_SECTIONS,
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
  for (const section of DOC_SECTIONS) {
    for (const article of section.articles) {
      params.push({ slug: [section.slug, article.slug] });
    }
  }
  return params;
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

  const breadcrumbs = getBreadcrumbs(sectionSlug, articleSlug);
  const prevNext = getPrevNext(sectionSlug, articleSlug);

  return (
    <article>
      <DocsBreadcrumb items={breadcrumbs} />
      <h1 className="mb-6 text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-white">
        {article.title}
      </h1>
      <MDXContent sectionSlug={sectionSlug} articleSlug={articleSlug} />
      <DocsPrevNext prev={prevNext.prev} next={prevNext.next} />
    </article>
  );
}
