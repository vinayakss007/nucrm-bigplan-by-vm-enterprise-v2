'use client';
import type { WidgetProps, DashboardLayoutItem, WidgetConfig } from '@/types/dashboard';
import { LazyWidget } from './widget-wrapper';
import { getWidget } from './widget-registry';
import type { FC } from 'react';
import StatsContactsWidget from './widgets/stats-contacts-widget';
import StatsPipelineWidget from './widgets/stats-pipeline-widget';
import StatsRevenueWidget from './widgets/stats-revenue-widget';
import StatsTasksWidget from './widgets/stats-tasks-widget';
import ActivityFeedWidget from './widgets/activity-feed-widget';
import TasksWidget from './widgets/tasks-widget';
import DealsClosingWidget from './widgets/deals-closing-widget';
import ContactsRecentWidget from './widgets/contacts-recent-widget';
import LeadsPipelineWidget from './widgets/leads-pipeline-widget';
import TicketsWidget from './widgets/tickets-widget';
import InvoicesWidget from './widgets/invoices-widget';
import FollowUpsWidget from './widgets/follow-ups-widget';

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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 auto-rows-auto">
      {sorted.map((item) => {
        const Component = WIDGET_MAP[item.widget];
        const widget = getWidget(item.widget);
        if (!Component || !widget) return null;

        const sizeClass = SIZE_CLASSES[item.size] ?? SIZE_CLASSES['1x1'];

        return (
          <div key={item.widget} className={sizeClass}>
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
