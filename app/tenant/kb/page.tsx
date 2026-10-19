/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import Link from 'next/link';
import { Book, Search, Plus, Clock, Eye, ThumbsUp, ChevronRight, FolderPlus } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import InlineErrorState from '@/components/shared/inline-error-state';
import { ListSkeleton } from '@/components/shared/page-skeleton';

interface KBArticle {
  id: string;
  title: string;
  excerpt?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  createdAt: string;
  views?: number | null;
  helpful?: number | null;
}

interface KBCategory {
  id: string;
  name: string;
}

const KB_ARTICLES_QUERY = ['tenant', 'kb', 'articles', 'published'] as const;
const KB_CATEGORIES_QUERY = ['tenant', 'kb', 'categories'] as const;

export default function KBPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  // #1328: reads via TanStack Query (were parallel raw fetch + useEffect).
  //
  // #2829: the articles read bound `error` and spent it on a toast fired from the
  // render body, then answered the refusal with "No articles found" — the same
  // sentence a search with no matches deserves. The categories read below bound no
  // `error` at all, so a refused one just made the category chips vanish, one of
  // the two ways in, and left the create-article modal offering "Uncategorized"
  // as the only choice.
  const { data: articlesData, isLoading: articlesLoading, error: articlesError, refetch: refetchArticles } = useApiQuery<{ data?: KBArticle[] }>(
    KB_ARTICLES_QUERY,
    '/api/tenant/kb/articles?status=published',
  );
  const { data: categoriesData, isLoading: categoriesLoading, error: categoriesError, refetch: refetchCategories } = useApiQuery<{ data?: KBCategory[] }>(
    KB_CATEGORIES_QUERY,
    '/api/tenant/kb/categories',
  );
  const articles: KBArticle[] = articlesData?.data ?? [];
  const categories: KBCategory[] = categoriesData?.data ?? [];
  const loading = articlesLoading || categoriesLoading;

  // #2869: `error` alone is two different situations wearing one name. TanStack keeps
  // `data` when a REFETCH of a query that already answered fails — and both of these
  // queries are invalidated by every mutation on the page (`load()` after a new article,
  // the category dialog's save) — so branching on `error` alone hides rows the operator
  // is reading behind an outage banner. `failed` is the read that never answered; `stale`
  // is the refresh that did not, over rows that stay on screen and stay usable.
  const failed = Boolean(articlesError) && !articlesData;
  const stale = Boolean(articlesError) && Boolean(articlesData);
  const reason = articlesError?.message || 'no response from the server';
  const categoriesFailed = Boolean(categoriesError) && !categoriesData;
  // A refresh of the categories that failed over the list already on screen. Chip labels
  // are still correct, so the filter keeps working; only the *sentence* under the chips
  // has to be honest about what it is doing.
  const categoriesStale = Boolean(categoriesError) && Boolean(categoriesData);
  const categoriesReason = categoriesError?.message || 'no response from the server';
  // `activeCategory` is state of its own, so it survives the chips disappearing and keeps
  // narrowing `filtered`. Saying "shown unfiltered" over a list that is filtered is the
  // same class of lie as the empty state this issue is about, moved into the error state.
  const filteringBlind = categoriesFailed && activeCategory !== 'all';

  const load = () => {
    queryClient.invalidateQueries({ queryKey: KB_ARTICLES_QUERY });
    queryClient.invalidateQueries({ queryKey: KB_CATEGORIES_QUERY });
  };

  const filtered = articles.filter(a => {
    if (activeCategory !== 'all' && a.categoryId !== activeCategory) return false;
    if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  // The read answered; only the filter found nothing. A statement about the workspace
  // ("No articles found") is not supported by it, and it sends the author looking for a
  // data problem when the problem is the box they typed in.
  const filteredToNothing = !failed && !loading && articles.length > 0 && filtered.length === 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Book className="w-5 h-5" />Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">Documentation, guides, and FAQs</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tenant/kb/categories"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors">
            <FolderPlus className="w-3.5 h-3.5" />Manage Categories
          </Link>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors">
            <Plus className="w-3.5 h-3.5" />New Article
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search articles..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all text-sm"
        />
      </div>

      {/* Categories */}
      {categoriesFailed ? (
        <InlineErrorState
          className="basis-full"
          message={filteringBlind
            ? `Failed to load the categories, so no chip can be chosen or cleared: ${categoriesReason}. The articles below are still narrowed to the category you picked before it went.`
            : `Failed to load the categories: ${categoriesReason} — the articles below are shown unfiltered`}
          onRetry={refetchCategories}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {categoriesStale && (
            <InlineErrorState
              className="basis-full"
              message={`Could not refresh the categories, so this row is the last read: ${categoriesReason}`}
              onRetry={refetchCategories}
            />
          )}
          <button onClick={() => setActiveCategory('all')}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              activeCategory === 'all' ? 'bg-violet-600 text-white' : 'bg-card border border-border text-muted-foreground hover:bg-accent')}>
            All
          </button>
          {categories.map(c => (
            <button key={c.id} onClick={() => setActiveCategory(c.id)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                activeCategory === c.id ? 'bg-violet-600 text-white' : 'bg-card border border-border text-muted-foreground hover:bg-accent')}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Article list */}
      <div className="grid gap-3">
        {stale && (
          <InlineErrorState
            message={`Could not refresh the knowledge base, so the articles below are the last read: ${reason}`}
            onRetry={refetchArticles}
          />
        )}
        {loading ? (
          <ListSkeleton rows={5} />
        ) : failed ? (
          <InlineErrorState
            message={`Failed to load the knowledge base: ${reason}`}
            onRetry={refetchArticles}
          />
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Book className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            {filteredToNothing ? (
              <>
                <p className="text-sm text-muted-foreground">No published articles match this search or category</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The knowledge base itself has {articles.length} published {articles.length === 1 ? 'article' : 'articles'} —
                  clear the search box, or choose All in the category chips above.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No published articles yet</p>
            )}
          </div>
        ) : filtered.map(a => (
          <Link key={a.id} href={`/tenant/kb/${a.id}`}
            className="group bg-card border border-border rounded-xl p-4 hover:border-violet-200 dark:hover:border-violet-800 transition-all hover:shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {a.categoryName && <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{a.categoryName}</span>}
                </div>
                <h3 className="font-semibold group-hover:text-violet-600 transition-colors">{a.title}</h3>
                {a.excerpt && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{a.excerpt}</p>}
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(a.createdAt)}</span>
                  <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{a.views || 0}</span>
                  {(a.helpful ?? 0) > 0 && <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{a.helpful}%</span>}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-violet-600 transition-colors shrink-0 mt-1" />
            </div>
          </Link>
        ))}
      </div>

      {/* Create article modal */}
      {showCreate && (
        <CreateArticleModal
          categories={categories}
          categoriesFailed={categoriesFailed}
          categoriesReason={categoriesReason}
          onRetryCategories={refetchCategories}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateArticleModal({
  categories, categoriesFailed, categoriesReason, onRetryCategories, onClose, onCreated,
}: {
  categories: KBCategory[];
  categoriesFailed: boolean;
  categoriesReason: string;
  onRetryCategories: () => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ title: '', content: '', excerpt: '', category_id: '', status: 'draft' });
  const [saving, setSaving] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.content.trim()) { toast.error('Content is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/kb/articles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (res.ok) { toast.success('Article created'); onCreated(); }
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
          <h2 className="font-semibold">New Article</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">✕</button>
        </div>
        <form onSubmit={create} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
            <input required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} placeholder="Article title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
              <select value={form.category_id} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))} className={inp}>
                <option value="">Uncategorized</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {/* An unread category list is not an empty one. Said nowhere, the author sees a
                  dropdown with a single choice and files the article uncategorised — a data
                  decision made for them by a read that never answered. */}
              {categoriesFailed && (
                <InlineErrorState
                  className="mt-1.5"
                  message={`Failed to load the categories, so this dropdown offers only Uncategorized: ${categoriesReason}`}
                  onRetry={onRetryCategories}
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Excerpt</label>
            <input value={form.excerpt} onChange={e => setForm(p => ({ ...p, excerpt: e.target.value }))} className={inp} placeholder="Brief summary for listings" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Content *</label>
            <textarea rows={12} required value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} className={`${inp} font-mono text-xs`} placeholder="Write article content here...&#10;Supports Markdown" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Creating...' : 'Create Article'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
