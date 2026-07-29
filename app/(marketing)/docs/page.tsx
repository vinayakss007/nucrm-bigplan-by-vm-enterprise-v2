import Link from 'next/link';
import type { Metadata } from 'next';
import { getPublishedSections } from '@/lib/marketing/docs';
import { Icon } from '@/components/marketing/icon';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Everything you need to know about NuCRM. Guides, tutorials, and reference documentation for every feature.',
};

export default function DocsPage() {
  const sections = getPublishedSections();
  const totalArticles = sections.reduce((sum, s) => sum + s.articles.length, 0);

  return (
    <div>
      {/* Hero */}
      <div className="mb-12">
        <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em] text-white sm:text-[40px]">
          Documentation
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-[1.65] text-[#9aa4b8]">
          Everything you need to set up, configure, and get the most out of NuCRM.
          {' '}{totalArticles} guides across {sections.length} sections.
        </p>
      </div>

      {/* Section cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.slug}
            href={`/docs/${section.slug}/${section.articles[0]?.slug ?? ''}`}
            className="group flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors hover:border-violet-500/30 hover:bg-white/[0.04]"
          >
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 shadow-lg shadow-black/30">
                <Icon name={section.icon} className="h-4 w-4 text-white" strokeWidth={1.8} />
              </span>
              <h2 className="text-[15px] font-bold text-white group-hover:text-violet-200 transition-colors">
                {section.title}
              </h2>
            </div>
            <p className="flex-1 text-[13px] leading-[1.6] text-[#9aa4b8]">
              {section.description}
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-[#6b7488]">
              <span>{section.articles.length} articles</span>
              <Icon
                name="ArrowRight"
                className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
