'use client';
import dynamic from 'next/dynamic';

const KBArticleClient = dynamic(() => import('./kb-article-client'), {
  ssr: false,
  loading: () => (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="h-8 w-64 bg-muted rounded animate-pulse" />
      <div className="h-4 w-96 bg-muted rounded animate-pulse" />
      <div className="h-64 bg-muted rounded-xl animate-pulse" />
    </div>
  ),
});

export default function KBArticlePage() {
  return <KBArticleClient />;
}
