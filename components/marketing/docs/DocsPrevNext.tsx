import Link from 'next/link';
import { Icon } from '@/components/marketing/icon';
import type { PrevNext } from '@/lib/marketing/docs';

export function DocsPrevNext({ prev, next }: PrevNext) {
  if (!prev && !next) return null;

  return (
    <nav
      className="mt-12 grid gap-4 border-t border-white/[0.08] pt-8 sm:grid-cols-2"
      aria-label="Previous and next articles"
    >
      {prev ? (
        <Link
          href={`/docs/${prev.section}/${prev.slug}`}
          className="group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-5 py-4 transition-colors hover:border-violet-500/30 hover:bg-white/[0.04]"
        >
          <Icon
            name="ArrowLeft"
            className="h-4 w-4 shrink-0 text-[#6b7488] transition-transform group-hover:-translate-x-0.5"
          />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b7488]">
              Previous
            </div>
            <div className="truncate text-[13px] font-medium text-[#9aa4b8] group-hover:text-white">
              {prev.title}
            </div>
          </div>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={`/docs/${next.section}/${next.slug}`}
          className="group flex items-center justify-end gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-5 py-4 text-right transition-colors hover:border-violet-500/30 hover:bg-white/[0.04]"
        >
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b7488]">
              Next
            </div>
            <div className="truncate text-[13px] font-medium text-[#9aa4b8] group-hover:text-white">
              {next.title}
            </div>
          </div>
          <Icon
            name="ArrowRight"
            className="h-4 w-4 shrink-0 text-[#6b7488] transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}
