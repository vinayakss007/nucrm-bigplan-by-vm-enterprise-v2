'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Book, Search, ChevronRight, Clock, Eye } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export default function PortalKBPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/public/kb/articles?status=published').then(r => r.json()).then(d => {
      setArticles(d.data || []); setLoading(false);
    }).catch((err) => { console.error('[portal/kb] fetch failed', err); setLoading(false); });
  }, []);

  const filtered = articles.filter(a =>
    !search || a.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><Book className="w-5 h-5" />Knowledge Base</h1>
        <p className="text-sm text-muted-foreground">Help articles and guides</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search articles..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all text-sm"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Book className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No articles found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(a => (
            <Link key={a.id} href={`/portal/kb/${a.id}`}
              className="group bg-card border border-border rounded-xl p-4 hover:border-violet-200 dark:hover:border-violet-800 transition-all flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold group-hover:text-violet-600 transition-colors">{a.title}</h3>
                {a.excerpt && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{a.excerpt}</p>}
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(a.createdAt)}</span>
                  {a.views > 0 && <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{a.views} views</span>}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-violet-600 transition-colors shrink-0 mt-1" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
