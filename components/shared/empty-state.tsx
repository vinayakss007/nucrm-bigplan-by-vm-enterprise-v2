'use client';

import Link from 'next/link';
import { Plus, Search, Users, TrendingUp, CheckSquare, Building2, FileText, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

type EmptyStateType = 'contacts' | 'deals' | 'tasks' | 'companies' | 'invoices' | 'search' | 'generic';

interface EmptyStateProps {
  type?: EmptyStateType;
  title?: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  className?: string;
}

const ILLUSTRATIONS: Record<EmptyStateType, {
  icon: any;
  bg: string;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}> = {
  contacts: {
    icon: Users,
    bg: 'from-violet-100 to-indigo-100 dark:from-violet-900/20 dark:to-indigo-900/20',
    title: 'No contacts yet',
    description: 'Import your contacts or add your first one to get started.',
    actionLabel: 'Add Contact',
    actionHref: '/tenant/contacts?action=create',
  },
  deals: {
    icon: TrendingUp,
    bg: 'from-amber-100 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20',
    title: 'Your pipeline is empty',
    description: 'Create your first deal to start tracking revenue.',
    actionLabel: 'Create Deal',
    actionHref: '/tenant/deals?action=create',
  },
  tasks: {
    icon: CheckSquare,
    bg: 'from-blue-100 to-cyan-100 dark:from-blue-900/20 dark:to-cyan-900/20',
    title: 'All caught up!',
    description: 'No tasks here. Create one to stay organized.',
    actionLabel: 'Create Task',
    actionHref: '/tenant/tasks?action=create',
  },
  companies: {
    icon: Building2,
    bg: 'from-emerald-100 to-teal-100 dark:from-emerald-900/20 dark:to-teal-900/20',
    title: 'No companies added',
    description: 'Add companies to organize your contacts by organization.',
    actionLabel: 'Add Company',
    actionHref: '/tenant/companies?action=create',
  },
  invoices: {
    icon: FileText,
    bg: 'from-green-100 to-emerald-100 dark:from-green-900/20 dark:to-emerald-900/20',
    title: 'No invoices yet',
    description: 'Create your first invoice to start billing clients.',
    actionLabel: 'Create Invoice',
    actionHref: '/tenant/invoices?action=create',
  },
  search: {
    icon: Search,
    bg: 'from-slate-100 to-gray-100 dark:from-slate-800/30 dark:to-gray-800/30',
    title: 'No results found',
    description: 'Try adjusting your filters or search term.',
    actionLabel: 'Clear Filters',
    actionHref: '',
  },
  generic: {
    icon: Mail,
    bg: 'from-violet-100 to-purple-100 dark:from-violet-900/20 dark:to-purple-900/20',
    title: 'Nothing here yet',
    description: 'Get started by creating your first item.',
    actionLabel: 'Get Started',
    actionHref: '',
  },
};

/**
 * Premium empty state component with CSS illustration.
 *
 * Usage:
 *   <EmptyState type="contacts" />
 *   <EmptyState type="deals" onAction={() => setShowModal(true)} />
 *   <EmptyState title="Custom title" description="Custom desc" />
 */
export function EmptyState({
  type = 'generic',
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
}: EmptyStateProps) {
  const config = ILLUSTRATIONS[type];
  const Icon = config.icon;

  const displayTitle = title || config.title;
  const displayDesc = description || config.description;
  const displayAction = actionLabel || config.actionLabel;
  const displayHref = actionHref ?? config.actionHref;

  return (
    <div className={cn('flex flex-col items-center justify-center py-16 sm:py-20 px-4 text-center', className)}>
      {/* Illustration */}
      <div className="relative mb-8">
        {/* Background glow */}
        <div className={cn(
          'absolute inset-0 rounded-full blur-2xl opacity-60',
          `bg-gradient-to-br ${config.bg}`
        )} style={{ width: '120px', height: '120px', margin: 'auto', left: 0, right: 0, top: 0, bottom: 0 }} />

        {/* Icon container with floating elements */}
        <div className="relative">
          <div className={cn(
            'w-20 h-20 rounded-2xl flex items-center justify-center',
            'bg-gradient-to-br shadow-lg',
            config.bg
          )}>
            <Icon className="w-9 h-9 text-muted-foreground/60" />
          </div>

          {/* Floating decorative dots */}
          <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-violet-200 dark:bg-violet-800/40 animate-pulse" />
          <div className="absolute -bottom-1 -left-3 w-3 h-3 rounded-full bg-indigo-200 dark:bg-indigo-800/40 animate-pulse" style={{ animationDelay: '0.5s' }} />
          <div className="absolute top-1/2 -right-4 w-2 h-2 rounded-full bg-primary/20 animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
      </div>

      {/* Text */}
      <h3 className="text-lg font-bold text-foreground mb-2">{displayTitle}</h3>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-8">{displayDesc}</p>

      {/* Action */}
      {(displayHref || onAction) && (
        onAction ? (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-violet-500/20 hover:-translate-y-0.5 transition-all duration-300"
          >
            <Plus className="w-4 h-4" />
            {displayAction}
          </button>
        ) : (
          <Link
            href={displayHref}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-violet-500/20 hover:-translate-y-0.5 transition-all duration-300"
          >
            <Plus className="w-4 h-4" />
            {displayAction}
          </Link>
        )
      )}
    </div>
  );
}
