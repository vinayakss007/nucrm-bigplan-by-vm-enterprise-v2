'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
<<<<<<< HEAD
import { Book, ArrowLeft, ThumbsUp, ThumbsDown, Clock, Eye } from 'lucide-react';
=======
import { Book, ArrowLeft, ThumbsUp, ThumbsDown } from 'lucide-react';
>>>>>>> fix/batch-2-e2e-useEffect
import { cn, formatDate } from '@/lib/utils';

export default function PortalKBArticlePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [helpful, setHelpful] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`/api/public/kb/articles/${params.id}`).then(r => r.json()).then(d => {
      setArticle(d.data); setLoading(false);
    }).catch((err) => { console.error('[portal/kb/article] fetch failed', err); setLoading(false); });
  }, [params.id]);

  if (loading) return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="h-8 w-64 bg-muted rounded animate-pulse" />
      <div className="h-64 bg-muted rounded-xl animate-pulse" />
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
