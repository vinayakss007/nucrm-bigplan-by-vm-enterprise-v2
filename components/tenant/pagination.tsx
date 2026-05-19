'use client';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
}

export default function Pagination({ total, offset, limit, onChange }: Props) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  const from = offset + 1;
  const to = Math.min(offset + limit, total);

  const go = (p: number) => onChange((p - 1) * limit);

  const pageNums = () => {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    if (page <= 4) return [1, 2, 3, 4, 5, '...', pages];
    if (page >= pages - 3) return [1, '...', pages-4, pages-3, pages-2, pages-1, pages];
    return [1, '...', page-1, page, page+1, '...', pages];
  };

  return (
    <div className="flex items-center justify-between px-1 py-2">
      <p className="text-xs text-muted-foreground">{from}–{to} of {total.toLocaleString()}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => go(page - 1)} disabled={page === 1}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pageNums().map((p, i) => (
          typeof p === 'string'
            ? <span key={i} className="w-8 h-8 flex items-center justify-center text-xs text-muted-foreground">…</span>
            : <button key={i} onClick={() => go(p)}
                className={cn('w-8 h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-colors',
                  p === page ? 'bg-violet-600 text-white' : 'hover:bg-accent border border-border')}>
                {p}
              </button>
        ))}
        <button onClick={() => go(page + 1)} disabled={page === pages}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
