'use client';

import { useState } from 'react';
import { DocsSidebar } from '@/components/marketing/docs/DocsSidebar';
import { DocsSearch } from '@/components/marketing/docs/DocsSearch';
import { DocsTableOfContents } from '@/components/marketing/docs/DocsTableOfContents';
import { Icon } from '@/components/marketing/icon';
import './docs.css';

/**
 * Docs nested layout: sidebar on the left, content in the middle,
 * table of contents on the right (desktop only).
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="relative pt-20">
      {/* Mobile sidebar toggle */}
      <div className="sticky top-16 z-30 border-b border-white/[0.08] bg-[#06060e]/95 px-5 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px] text-[#9aa4b8] transition-colors hover:bg-white/[0.05]"
          aria-expanded={sidebarOpen}
          aria-label="Toggle documentation navigation"
        >
          <Icon name="Menu" className="h-4 w-4" />
          <span>Navigation</span>
        </button>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <div className="mx-auto w-full max-w-[1400px] px-5 sm:px-8">
        <div className="flex gap-0 lg:gap-8">
          {/* Sidebar */}
          <aside
            className={`fixed top-0 left-0 z-50 h-full w-[280px] overflow-y-auto border-r border-white/[0.08] bg-[#06060e] px-4 py-6 transition-transform duration-300 lg:sticky lg:top-20 lg:z-0 lg:h-[calc(100vh-80px)] lg:translate-x-0 lg:border-r-0 lg:bg-transparent lg:px-0 lg:py-0 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="mb-5">
              <DocsSearch />
            </div>
            <DocsSidebar />
          </aside>

          {/* Main content */}
          <div className="min-w-0 flex-1 py-8 lg:py-10 lg:pl-[280px] xl:pr-[220px]">
            <div className="docs-prose mx-auto max-w-[820px]">
              {children}
            </div>
          </div>

          {/* Right side table of contents */}
          <aside className="hidden xl:block">
            <DocsTableOfContents className="sticky top-24 w-[200px] py-10" />
          </aside>
        </div>
      </div>
    </div>
  );
}
