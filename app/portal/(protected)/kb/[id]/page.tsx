/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Book, ArrowLeft, ThumbsUp, ThumbsDown, Clock, Eye } from 'lucide-react';
import InlineErrorState from '@/components/shared/inline-error-state';
import { cn, formatDate } from '@/lib/utils';
import { useApiQuery } from '@/lib/query/client';

interface KBArticle {
  id: string;
  title: string;
  content: string;
  excerpt?: string;
  categoryName?: string;
  views?: number;
  createdAt: string;
}

export default function PortalKBArticlePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState(false);
  const [helpful, setHelpful] = useState<boolean | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('portal_session');
    if (!raw) { router.replace('/portal/login'); return; }
    try {
      const s = JSON.parse(raw);
      if (!s.email) { router.replace('/portal/login'); return; }
      setSessionReady(true);
    } catch { router.replace('/portal/login'); return; }
  }, [router]);

  const { data, isLoading, error, refetch } = useApiQuery<{ data: KBArticle }>(
    ['portal-kb-article', params.id],
    `/api/public/kb/articles/${params.id}`,
    { enabled: sessionReady },
  );
  const article = data?.data ?? null;
  const loading = !sessionReady || isLoading;

  // Three channels for the article read (#2872). Before, `!article` collapsed every non-success into
  // "Article not found": a dead pool or a 500 sent a visitor looking for a known article to a not-found
  // verdict, and a refused refresh over an already-loaded article said nothing about its freshness.
  const failed = Boolean(error) && !data;
  const stale = Boolean(error) && Boolean(data);
  const reason = error?.message || 'no response from the server';
  const status = error?.status ?? null;
  // A 404/410 is the server answering that the article is gone — the not-found state, never an outage.
  // But a 404 arriving on top of a kept read is a refused refresh, not a vanished article.
  const notFound = failed && (status === 404 || status === 410);

  if (loading) return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="h-8 w-64 bg-muted rounded animate-pulse" />
      <div className="h-64 bg-muted rounded-xl animate-pulse" />
    </div>
  );

  // The read never answered and the server said nothing about the article: an outage. This is not a
  // verdict that the article is gone — say what failed, and offer a retry bound to this read.
  if (failed && !notFound) return (
    <div className="max-w-3xl">
      <InlineErrorState
        message={`Could not load this article: ${reason}. This is not a verdict that it was removed — try again and the article will appear if the server answers.`}
        onRetry={() => void refetch()}
      />
    </div>
  );

  if (!article) return (
    <div className="text-center py-12">
      <Book className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">Article not found</p>
      <button onClick={() => router.push('/portal/kb')} className="mt-4 text-sm text-violet-600 hover:underline">Back to KB</button>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      {/* A refused refresh on top of an already-loaded article: the article stays on screen and the
          helpful-vote stays reachable; name which read the visitor is looking at. */}
      {stale && (
        <InlineErrorState
          message={`Could not refresh, so this article is the last read: ${reason}. Its contents, view count and category may have changed since.`}
          onRetry={() => void refetch()}
        />
      )}
      <button onClick={() => router.push('/portal/kb')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to KB
      </button>

      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        {article.categoryName && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{article.categoryName}</span>
        )}
        <h1 className="text-2xl font-bold mt-2 mb-3">{article.title}</h1>
        {article.excerpt && <p className="text-sm text-muted-foreground mb-4">{article.excerpt}</p>}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-6">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(article.createdAt)}</span>
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{article.views || 0} views</span>
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
          {article.content}
        </div>
        <div className="mt-8 pt-6 border-t border-border">
          <p className="text-sm text-muted-foreground mb-3">Was this article helpful?</p>
          <div className="flex gap-2">
            <button onClick={() => setHelpful(true)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                helpful === true ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 text-emerald-700' : 'border-border hover:bg-accent')}>
              <ThumbsUp className="w-3.5 h-3.5" /> Yes
            </button>
            <button onClick={() => setHelpful(false)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                helpful === false ? 'bg-red-50 dark:bg-red-950/20 border-red-200 text-red-700' : 'border-border hover:bg-accent')}>
              <ThumbsDown className="w-3.5 h-3.5" /> No
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
