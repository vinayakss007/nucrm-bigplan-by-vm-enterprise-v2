/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { showUndoToast } from '@/lib/undo';
import toast from 'react-hot-toast';

type ResourceType = 'contact' | 'deal' | 'task' | 'company' | 'lead' | 'project';

const API_PATH: Record<string, string> = {
  contact: 'contacts', deal: 'deals', task: 'tasks', company: 'companies', lead: 'leads', project: 'projects',
};

/**
 * Reusable delete-with-undo hook.
 * Soft-deletes the entity, shows an undo toast (10s), and restores via trash PATCH on undo.
 */
export function useDeleteWithUndo(resourceType: ResourceType, onRefresh: () => void) {
  const deleteEntity = async (id: string, confirmMessage: string) => {
    await confirmThen(confirmMessage, async () => {
      const res = await fetch(`/api/tenant/${API_PATH[resourceType]}/${id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete'); return; }

      const label = resourceType.charAt(0).toUpperCase() + resourceType.slice(1);
      showUndoToast(`${label} deleted`, async () => {
        const restoreRes = await fetch('/api/tenant/trash', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, resource_type: resourceType }),
        });
        if (!restoreRes.ok) throw new Error('Restore failed');
        toast.success('Restored');
        onRefresh();
      });
      onRefresh();
    });
  };

  return { deleteEntity };
}
