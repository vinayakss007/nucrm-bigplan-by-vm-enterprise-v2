/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect } from 'react';
import { useApiQuery } from '@/lib/query/client';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';

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

// API responses vary ({data} | {activities} | []); normalize.
interface ActivitiesResponse { data?: ActivityItem[]; activities?: ActivityItem[] }

export default function ActivitiesPage() {
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // #1328: TanStack Query — offset is part of the queryKey, so paging back and
  // forth is instant from cache and keepPreviousData avoids a loading flash.
  const { data, isLoading, error } = useApiQuery<ActivitiesResponse | ActivityItem[]>(
    ['tenant', 'activities', offset, limit],
    `/api/tenant/activities?limit=${limit}&offset=${offset}`,
    { placeholderData: (prev) => prev },
  );
  const activities: ActivityItem[] = Array.isArray(data)
    ? data
    : data?.data ?? data?.activities ?? [];

  useEffect(() => {
    if (error) toast.error('Failed to load activities');
  }, [error]);

  const loading = isLoading;

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
        <EmptyState
          type="generic"
          title="No activity yet"
          description="Actions across your workspace — created deals, updated contacts, sent emails — will appear here as your team works."
        />
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
