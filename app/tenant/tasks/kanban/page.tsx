'use client';
import dynamic from 'next/dynamic';

const KanbanClient = dynamic(() => import('./kanban-client'), {
  ssr: false,
  loading: () => (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-8 w-20 bg-muted rounded" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="admin-card p-3 h-16" />)}
      </div>
      <div className="flex gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="w-72 h-48 bg-muted rounded-xl" />)}
      </div>
    </div>
  ),
});

export default function TasksKanbanPage() {
  return <KanbanClient />;
}
