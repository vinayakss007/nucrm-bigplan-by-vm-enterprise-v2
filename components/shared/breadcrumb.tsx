'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

/**
 * Automatic breadcrumb navigation based on URL path.
 *
 * Usage:
 *   <Breadcrumb /> — auto-generates from current URL
 *   <Breadcrumb items={[{ label: 'Contacts', href: '/tenant/contacts' }, { label: 'John Doe' }]} />
 */

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  className?: string;
}

const PATH_LABELS: Record<string, string> = {
  tenant: 'Home',
  dashboard: 'Dashboard',
  contacts: 'Contacts',
  companies: 'Companies',
  deals: 'Deals',
  tasks: 'Tasks',
  leads: 'Leads',
  calendar: 'Calendar',
  invoices: 'Invoices',
  orders: 'Orders',
  contracts: 'Contracts',
  quotes: 'Quotes',
  subscriptions: 'Subscriptions',
  reports: 'Reports',
  analytics: 'Analytics',
  settings: 'Settings',
  automation: 'Automation',
  sequences: 'Sequences',
  tickets: 'Tickets',
  kb: 'Knowledge Base',
  docs: 'API Docs',
  integrations: 'Integrations',
  modules: 'Modules',
  notifications: 'Notifications',
  search: 'Search',
  services: 'Services',
  forms: 'Forms',
  trash: 'Trash',
  general: 'General',
  profile: 'Profile',
  team: 'Team',
  billing: 'Billing',
  security: 'Security',
  roles: 'Roles',
  'api-keys': 'API Keys',
  webhooks: 'Webhooks',
  'custom-fields': 'Custom Fields',
  audit: 'Audit Log',
  backup: 'Backup',
  pipelines: 'Pipelines',
  builder: 'Builder',
  forecast: 'Forecast',
};

export function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  const pathname = usePathname();

  // Auto-generate from pathname if no items provided
  const breadcrumbs = items || generateFromPath(pathname);

  // Don't show breadcrumbs on dashboard (root)
  if (breadcrumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1.5 text-xs text-muted-foreground mb-4 ${className}`}>
      <Link
        href="/tenant/dashboard"
        className="flex items-center gap-1 hover:text-foreground transition-colors p-1 -ml-1 rounded"
      >
        <Home className="w-3 h-3" />
      </Link>

      {breadcrumbs.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
          {item.href && i < breadcrumbs.length - 1 ? (
            <Link
              href={item.href}
              className="hover:text-foreground transition-colors font-medium"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-semibold truncate max-w-[200px]">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

function generateFromPath(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);

  // Skip 'tenant' prefix
  const startIndex = segments[0] === 'tenant' ? 1 : 0;
  const items: BreadcrumbItem[] = [];

  for (let i = startIndex; i < segments.length; i++) {
    const segment = segments[i]!;
    const label = PATH_LABELS[segment] || formatSegment(segment);
    const href = '/' + segments.slice(0, i + 1).join('/');

    items.push({ label, href });
  }

  return items;
}

function formatSegment(segment: string): string {
  // UUID-like segments → show as "Detail"
  if (segment.length > 20 && segment.includes('-')) return 'Detail';
  // Capitalize and replace dashes
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
