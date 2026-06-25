'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, Clock, Eye, ThumbsUp, ThumbsDown, Edit, Trash2, X } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { logError } from '@/lib/errors';

export default function KBArticlePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [article, setArticle] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [voted, setVoted] = useState<'helpful' | 'not_helpful' | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenant/kb/articles/${params.id}`);
      if (!res.ok) { router.push('/tenant/kb'); return; }
      const d = await res.json();
      setArticle(d.data as any);
    } catch (err) { logError({ error: err, context: "catch:[context]" }); } finally { setLoading(false); }
  }, [params.id, router]);

  useEffect(() => { load(); }, [params.id, load]);

  const vote = async (action: 'helpful' | 'not_helpful') => {
    if (voted) return;
    try {
      const res = await fetch(`/api/tenant/kb/articles/${params.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setVoted(action);
        const d = await res.json();
        setArticle((prev: any | null) => ({ ...prev, helpful: d.data.helpful, notHelpful: d.data.notHelpful }));
      }
    } catch (err) { logError({ error: err, context: "catch:[context]" }); }
  };

  const deleteArticle = async () => {
    await confirmThen('Delete this article?', async () => {
      const res = await fetch(`/api/tenant/kb/articles/${params.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Deleted'); router.push('/tenant/kb'); }
      else toast.error('Failed');
    });
  };

  if (loading) return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="h-8 w-64 bg-muted rounded animate-pulse" />
      <div className="h-4 w-96 bg-muted rounded animate-pulse" />
      <div className="h-64 bg-muted rounded-xl animate-pulse" />
    </div>
  );

  if (!article) return null;

  const totalVotes = (article.helpful || 0) + (article.notHelpful || 0);
  const helpfulPct = totalVotes > 0 ? Math.round((article.helpful / totalVotes) * 100) : null;

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div className="flex items-center justify-between">
        <button onClick={() => router.push('/tenant/kb')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to KB
        </button>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowEdit(true)} className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <Edit className="w-4 h-4" />
          </button>
          <button onClick={deleteArticle} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        {article.categoryName && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{article.categoryName}</span>
        )}
        <h1 className="text-2xl font-bold mt-2 mb-3">{article.title}</h1>
        {article.excerpt && <p className="text-sm text-muted-foreground mb-4">{article.excerpt}</p>}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-6">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(article.createdAt)}</span>
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{article.views || 0} views</span>
          {helpfulPct !== null && (
            <span className="flex items-center gap-1 text-emerald-600"><ThumbsUp className="w-3 h-3" />{helpfulPct}% helpful</span>
          )}
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.content}</ReactMarkdown>
        </div>

        {/* Voting */}
        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium mb-2">Was this article helpful?</p>
          <div className="flex items-center gap-2">
            <button onClick={() => vote('helpful')} disabled={!!voted}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                voted === 'helpful' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' :
                'border-border hover:bg-accent text-muted-foreground disabled:opacity-40')}>
              <ThumbsUp className="w-3.5 h-3.5" /> Yes ({article.helpful || 0})
            </button>
            <button onClick={() => vote('not_helpful')} disabled={!!voted}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                voted === 'not_helpful' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' :
                'border-border hover:bg-accent text-muted-foreground disabled:opacity-40')}>
              <ThumbsDown className="w-3.5 h-3.5" /> No ({article.notHelpful || 0})
            </button>
          </div>
        </div>
      </div>

      {showEdit && <EditArticleModal article={article} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EditArticleModal({ article, onClose, onSaved }: { article: Record<string, any>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: article.title, content: article.content, excerpt: article.excerpt || '', category_id: article.categoryId || '', status: article.status });
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.content.trim()) { toast.error('Content is required'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/tenant/kb/articles/${article.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (res.ok) { toast.success('Article updated'); onSaved(); }
      else { const d = await res.json(); toast.error(d.error || 'Failed'); }
    } catch { toast.error('Failed'); }
    setSaving(false);
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="font-semibold">Edit Article</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={save} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
            <input required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
              <select value={form.category_id} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))} className={inp}>
                <option value="">Uncategorized</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Excerpt</label>
            <input value={form.excerpt} onChange={e => setForm(p => ({ ...p, excerpt: e.target.value }))} className={inp} placeholder="Brief summary" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Content *</label>
            <textarea rows={12} required value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} className={`${inp} font-mono text-xs`} placeholder="Markdown supported..." />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
