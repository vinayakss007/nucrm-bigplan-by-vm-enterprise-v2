'use client';
import dynamic from 'next/dynamic';
import type { WidgetProps, DashboardLayoutItem } from '@/types/dashboard';
import { LazyWidget } from './widget-wrapper';
import { getWidget } from './widget-registry';
import type { FC } from 'react';

const StatsContactsWidget = dynamic(() => import('./widgets/stats-contacts-widget'), { ssr: false });
const StatsPipelineWidget = dynamic(() => import('./widgets/stats-pipeline-widget'), { ssr: false });
const StatsRevenueWidget = dynamic(() => import('./widgets/stats-revenue-widget'), { ssr: false });
const StatsTasksWidget = dynamic(() => import('./widgets/stats-tasks-widget'), { ssr: false });
const ActivityFeedWidget = dynamic(() => import('./widgets/activity-feed-widget'), { ssr: false });
const TasksWidget = dynamic(() => import('./widgets/tasks-widget'), { ssr: false });
const DealsClosingWidget = dynamic(() => import('./widgets/deals-closing-widget'), { ssr: false });
const ContactsRecentWidget = dynamic(() => import('./widgets/contacts-recent-widget'), { ssr: false });
const LeadsPipelineWidget = dynamic(() => import('./widgets/leads-pipeline-widget'), { ssr: false });
const TicketsWidget = dynamic(() => import('./widgets/tickets-widget'), { ssr: false });
const InvoicesWidget = dynamic(() => import('./widgets/invoices-widget'), { ssr: false });
const FollowUpsWidget = dynamic(() => import('./widgets/follow-ups-widget'), { ssr: false });

const WIDGET_MAP: Record<string, FC<WidgetProps>> = {
  'stats-contacts': StatsContactsWidget,
  'stats-pipeline': StatsPipelineWidget,
  'stats-revenue': StatsRevenueWidget,
  'stats-tasks': StatsTasksWidget,
  'activity-feed': ActivityFeedWidget,
  'tasks-list': TasksWidget,
  'deals-closing': DealsClosingWidget,
  'contacts-recent': ContactsRecentWidget,
  'leads-pipeline': LeadsPipelineWidget,
  'tickets-widget': TicketsWidget,
  'invoices-widget': InvoicesWidget,
  'follow-ups-list': FollowUpsWidget,
};

const SIZE_CLASSES: Record<string, string> = {
  '1x1': 'col-span-1 row-span-1',
  '2x1': 'col-span-2 row-span-1',
  '1x2': 'col-span-1 row-span-2',
  '2x2': 'col-span-2 row-span-2',
};

interface WidgetGridProps {
  layout: DashboardLayoutItem[]
  tenantId: string
  userId: string
  isAdmin: boolean
}

export function WidgetGrid({ layout, tenantId, userId, isAdmin }: WidgetGridProps) {
  const sorted = [...layout].sort((a, b) => a.position - b.position);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-[minmax(120px,auto)]">
      {sorted.map((item) => {
        const Component = WIDGET_MAP[item.widget];
        const widget = getWidget(item.widget);
        if (!Component || !widget) return null;

        const sizeClass = SIZE_CLASSES[item.size] ?? SIZE_CLASSES['1x1'];

        return (
          <div key={item.widget} className={`${sizeClass} h-full`}>
            <LazyWidget
              widget={widget}
              size={item.size}
              tenantId={tenantId}
              userId={userId}
              isAdmin={isAdmin}
              config={item.config}
            >
              {(props) => <Component {...props} />}
            </LazyWidget>
          </div>
        );
      })}
    </div>
  );
}
