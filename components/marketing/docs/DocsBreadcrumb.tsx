import Link from 'next/link';
import { Icon } from '@/components/marketing/icon';
import type { DocBreadcrumb } from '@/lib/marketing/docs';

export function DocsBreadcrumb({ items }: { items: DocBreadcrumb[] }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1.5" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={item.href} className="flex items-center gap-1.5">
          {i > 0 && <Icon name="ChevronRight" className="h-3 w-3 text-[#6b7488]" />}
          {i < items.length - 1 ? (
            <Link
              href={item.href}
              className="text-[12px] font-medium text-[#6b7488] transition-colors hover:text-violet-300"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-[12px] font-medium text-[#9aa4b8]">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
