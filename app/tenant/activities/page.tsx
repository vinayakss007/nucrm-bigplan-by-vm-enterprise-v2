'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';

interface ActivityItem {
  id: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  description?: string;
  user_id?: string;
  user_name?: string;
  created_at: string;
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/activities?limit=${limit}&offset=${offset}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setActivities(data.data ?? data.activities ?? data ?? []);
    } catch {
      toast.error('Failed to load activities');
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const actionColor = (action: string) => {
    if (action.includes('create')) return 'bg-green-500';
    if (action.includes('update') || action.includes('edit')) return 'bg-blue-500';
    if (action.includes('delete') || action.includes('remove')) return 'bg-red-500';
    return 'bg-gray-400';
  };

  if (loading) return <div className="p-6 animate-pulse"><div className="h-8 bg-muted rounded w-48 mb-4" /><div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-muted rounded" />)}</div></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activities</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            <ChevronLeft className="w-4 h-4" />Prev
          </Button>
          <span className="text-sm text-muted-foreground">Page {Math.floor(offset / limit) + 1}</span>
          <Button variant="outline" size="sm" disabled={activities.length < limit} onClick={() => setOffset(offset + limit)}>
            Next<ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No activities recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {activities.map(a => (
            <div key={a.id} className="flex items-start gap-3 p-3 hover:bg-muted/50 rounded-lg transition-colors">
              <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${actionColor(a.action)}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{a.action}</span>
                  {a.entity_type && <span className="text-xs px-1.5 py-0.5 bg-muted rounded">{a.entity_type}</span>}
                </div>
                {a.description && <p className="text-sm text-muted-foreground mt-0.5 truncate">{a.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {a.user_name && <span>{a.user_name}</span>}
                  <span>{new Date(a.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
