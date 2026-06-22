'use client';
import { useState } from 'react';
import DealsDataTable from '@/components/tenant/deals-data-table';
import DealsKanban from '@/components/tenant/deals-kanban';
import { cn } from '@/lib/utils';

interface Props {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialDeals: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  stages: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  contacts: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  companies: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamMembers: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  permissions: any;
  defaultView?: string;
}

export default function DealsPageClient({ initialDeals, stages, contacts, companies, teamMembers, permissions, defaultView }: Props) {
  const [view, setView] = useState<'kanban' | 'table'>(
    (defaultView === 'kanban' || defaultView === 'card') ? 'kanban' : 'table'
  );

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setView('kanban')}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            view === 'kanban'
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
              : 'text-muted-foreground hover:bg-secondary'
          )}
        >
          Kanban
        </button>
        <button
          onClick={() => setView('table')}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            view === 'table'
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
              : 'text-muted-foreground hover:bg-secondary'
          )}
        >
          Table
        </button>
      </div>

      {view === 'kanban' ? (
        <DealsKanban
          initialDeals={initialDeals} stages={stages} contacts={contacts} companies={companies}
          teamMembers={teamMembers} permissions={permissions}
        />
      ) : (
        <DealsDataTable
          initialDeals={initialDeals} contacts={contacts} companies={companies}
          teamMembers={teamMembers} permissions={permissions}
        />
      )}
    </>
  );
}
