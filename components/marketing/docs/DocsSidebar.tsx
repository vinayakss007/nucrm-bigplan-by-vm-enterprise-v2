'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { DOC_SECTIONS } from '@/lib/marketing/docs';
import { Icon } from '@/components/marketing/icon';

export function DocsSidebar({ className = '' }: { className?: string }) {
  const pathname = usePathname();
  // Determine which section is currently active
  const activeSection = DOC_SECTIONS.find((s) =>
    pathname.startsWith(`/docs/${s.slug}`),
  );

  return (
    <nav aria-label="Documentation navigation" className={className}>
      <div className="space-y-1">
        {DOC_SECTIONS.map((section) => (
          <SidebarSection
            key={section.slug}
            section={section}
            pathname={pathname}
            defaultOpen={section.slug === activeSection?.slug}
          />
        ))}
      </div>
    </nav>
  );
}

function SidebarSection({
  section,
  pathname,
  defaultOpen,
}: {
  section: (typeof DOC_SECTIONS)[number];
  pathname: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isActive = pathname.startsWith(`/docs/${section.slug}`);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
          isActive
            ? 'bg-white/[0.05] text-white'
            : 'text-[#9aa4b8] hover:bg-white/[0.03] hover:text-white'
        }`}
        aria-expanded={open}
      >
        <Icon name={section.icon} className="h-4 w-4 shrink-0 text-violet-400/70" strokeWidth={1.8} />
        <span className="flex-1 text-[13px] font-semibold">{section.title}</span>
        <Icon
          name="ChevronRight"
          className={`h-3.5 w-3.5 shrink-0 text-[#6b7488] transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-white/[0.06] pl-3">
          {section.articles.map((article) => {
            const href = `/docs/${section.slug}/${article.slug}`;
            const isCurrent = pathname === href;
            return (
              <li key={article.slug}>
                <Link
                  href={href}
                  className={`block rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                    isCurrent
                      ? 'bg-violet-500/10 text-violet-300 font-medium'
                      : 'text-[#9aa4b8] hover:bg-white/[0.03] hover:text-white'
                  }`}
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  {article.title}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
