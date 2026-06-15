'use client';
import { useMemo } from 'react';
import {
  PanelLeftClose, Eye, EyeOff, Briefcase, UserCheck, Users, Crown, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sidebar customization — let each user hide nav items they don't use.
 *
 * Rendered inside the Preferences page. Persists to
 * users.metadata.prefs.hidden_nav_items[]. Respected by <TenantSidebar />
 * via the `nucrm.prefs.cache` sessionStorage entry that
 * <UserPreferencesApplier /> populates.
 */

// Catalog of every nav item the tenant sidebar exposes. Mirrors NAV_SECTIONS
// in components/tenant/layout/sidebar.tsx — keep in sync. We accept the
// short-term duplication because settings is a server component while the
// sidebar is client-only and we want this list usable from both.
const CATALOG = [
  { section: 'Work', items: [
    ['/tenant/dashboard',  'Dashboard'],
    ['/tenant/leads',      'Leads'],
    ['/tenant/contacts',   'Contacts'],
    ['/tenant/companies',  'Companies'],
    ['/tenant/deals',      'Deals'],
    ['/tenant/tasks',      'Tasks'],
    ['/tenant/calendar',   'Calendar'],
  ]},
  { section: 'Intelligence', items: [
    ['/tenant/ai',                'AI Hub'],
    ['/tenant/ai/draft',          'Auto-Draft'],
    ['/tenant/ai/lead-scoring',   'Lead Scoring'],
    ['/tenant/ai/at-risk',        'At-Risk Deals'],
  ]},
  { section: 'Sales', items: [
    ['/tenant/quotes',        'Quotes'],
    ['/tenant/orders',        'Orders'],
    ['/tenant/contracts',     'Contracts'],
    ['/tenant/invoices',      'Invoices'],
    ['/tenant/subscriptions', 'Subscriptions'],
    ['/tenant/products',      'Products'],
    ['/tenant/services',      'Services'],
  ]},
  { section: 'Support & Knowledge', items: [
    ['/tenant/tickets', 'Helpdesk'],
    ['/tenant/kb',      'Knowledge'],
    ['/tenant/chat',    'Live Chat'],
    ['/tenant/sms',     'SMS'],
  ]},
  { section: 'Automate', items: [
    ['/tenant/sequences',       'Sequences'],
    ['/tenant/automation',      'Workflows'],
    ['/tenant/forms',           'Forms'],
    ['/tenant/email-templates', 'Email Templates'],
  ]},
  { section: 'Analyze', items: [
    ['/tenant/reports',      'Reports'],
    ['/tenant/analytics',    'Analytics'],
    ['/tenant/leaderboards', 'Leaderboards'],
  ]},
  { section: 'Data & Trash', items: [
    ['/tenant/settings/import-export', 'Import / Export'],
    ['/tenant/settings/bulk-transfer', 'Bulk Transfer'],
    ['/tenant/settings/tags-manager',  'Tags Manager'],
    ['/tenant/trash',                  'Trash'],
  ]},
  { section: 'Developer', items: [
    ['/tenant/modules',               'Modules'],
    ['/tenant/plugins',               'Plugins'],
    ['/tenant/settings/webhooks',     'Webhooks'],
    ['/tenant/settings/api-keys',     'API Keys'],
    ['/tenant/docs',                  'API Docs'],
  ]},
] as const;

// Role presets — flip many toggles at once to match a persona.
const PRESETS = [
  {
    id: 'sales-rep',
    label: 'Sales Rep',
    icon: UserCheck,
    desc: 'Hide developer + analyze + data ops; keep core CRM + AI.',
    keep: [
      'Dashboard','Leads','Contacts','Companies','Deals','Tasks','Calendar',
      'AI Hub','Auto-Draft','Lead Scoring','At-Risk Deals',
      'Quotes','Orders','Invoices',
      'Sequences','Forms','Email Templates',
    ],
  },
  {
    id: 'sdr',
    label: 'SDR / BDR',
    icon: UserCheck,
    desc: 'Pure outbound — leads, sequences, AI drafting, calendar.',
    keep: [
      'Dashboard','Leads','Contacts','Tasks','Calendar',
      'AI Hub','Auto-Draft','Lead Scoring',
      'Sequences','Forms','Email Templates',
    ],
  },
  {
    id: 'csm',
    label: 'Customer Success',
    icon: Users,
    desc: 'Renewal-side: contacts, helpdesk, tickets, KB, AI summaries.',
    keep: [
      'Dashboard','Contacts','Companies','Tasks','Calendar',
      'AI Hub','Auto-Draft',
      'Helpdesk','Knowledge','Live Chat','SMS',
      'Subscriptions','Contracts','Invoices',
    ],
  },
  {
    id: 'manager',
    label: 'Manager',
    icon: Briefcase,
    desc: 'Reps + analytics + leaderboards + automate + data ops.',
    keep: [
      'Dashboard','Leads','Contacts','Companies','Deals','Tasks','Calendar',
      'AI Hub','Auto-Draft','Lead Scoring','At-Risk Deals',
      'Quotes','Orders','Contracts','Invoices','Subscriptions',
      'Reports','Analytics','Leaderboards',
      'Sequences','Workflows','Forms','Email Templates',
      'Bulk Transfer','Tags Manager',
    ],
  },
  {
    id: 'admin',
    label: 'Admin (everything)',
    icon: Crown,
    desc: 'See it all. Useful for org admins and IT.',
    keep: null, // null = nothing hidden
  },
  {
    id: 'minimal',
    label: 'Minimal',
    icon: Wrench,
    desc: 'Strict daily-driver — Dashboard, Tasks, Calendar, AI Hub only.',
    keep: ['Dashboard','Tasks','Calendar','AI Hub'],
  },
] as const;

// Build the all-hrefs flat list once, derived from CATALOG
const ALL_HREFS = CATALOG.flatMap(s => s.items.map(([href]) => href));
const LABEL_TO_HREF: Record<string, string> = Object.fromEntries(
  CATALOG.flatMap(s => s.items.map(([href, label]) => [label, href]))
);

export default function SidebarCustomizeSection({
  hidden, hiddenItems, onChange,
}: {
  hidden?: boolean;
  hiddenItems: string[];
  onChange: (next: string[]) => void;
}) {
  const hiddenSet = useMemo(() => new Set(hiddenItems), [hiddenItems]);

  if (hidden) return null;

  const visibleCount = ALL_HREFS.length - hiddenSet.size;

  const toggle = (href: string) => {
    const next = new Set(hiddenSet);
    if (next.has(href)) next.delete(href); else next.add(href);
    onChange(Array.from(next));
  };

  const showAll  = () => onChange([]);
  const hideAll  = () => onChange([...ALL_HREFS]);
  const applyPreset = (p: typeof PRESETS[number]) => {
    if (p.keep === null) { onChange([]); return; }
    const keepHrefs = new Set(p.keep.map(label => LABEL_TO_HREF[label]).filter((h): h is string => !!h));
    onChange(ALL_HREFS.filter(h => !keepHrefs.has(h)));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            <PanelLeftClose className="w-4 h-4 text-muted-foreground" /> Sidebar customization
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Hide what you don't use. {visibleCount} of {ALL_HREFS.length} visible · {hiddenSet.size} hidden.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={showAll} type="button"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border text-[11px] font-medium hover:bg-accent">
            <Eye className="w-3 h-3" /> Show all
          </button>
          <button onClick={hideAll} type="button"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border text-[11px] font-medium hover:bg-accent">
            <EyeOff className="w-3 h-3" /> Hide all
          </button>
        </div>
      </div>

      {/* Role presets */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Quick presets</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {PRESETS.map(p => {
            const Icon = p.icon;
            return (
              <button key={p.id} type="button" onClick={() => applyPreset(p)}
                className="group flex items-start gap-2 p-2.5 rounded-lg border border-border hover:border-violet-300 dark:hover:border-violet-800 hover:bg-violet-50/30 dark:hover:bg-violet-950/10 transition-all text-left">
                <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-violet-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{p.label}</p>
                  <p className="text-[10px] text-muted-foreground line-clamp-2">{p.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-section toggles — XL: 2-col grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {CATALOG.map(sec => {
          const allOn  = sec.items.every(([h]) => !hiddenSet.has(h));
          const allOff = sec.items.every(([h]) => hiddenSet.has(h));
          return (
            <div key={sec.section} className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{sec.section}</p>
                <button type="button"
                  onClick={() => {
                    if (allOn) {
                      onChange([...hiddenSet, ...sec.items.map(([h]) => h)]);
                    } else {
                      const next = new Set(hiddenSet);
                      sec.items.forEach(([h]) => next.delete(h));
                      onChange(Array.from(next));
                    }
                  }}
                  className="text-[10px] font-medium text-violet-600 hover:underline">
                  {allOn ? 'Hide all in section' : allOff ? 'Show all in section' : 'Show all'}
                </button>
              </div>
              <ul className="divide-y divide-border">
                {sec.items.map(([href, label]) => {
                  const visible = !hiddenSet.has(href);
                  return (
                    <li key={href} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/30 transition-colors">
                      <span className={cn('text-sm', !visible && 'text-muted-foreground line-through')}>{label}</span>
                      <button type="button" role="switch" aria-checked={visible}
                        onClick={() => toggle(href)}
                        className={cn(
                          'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
                          visible ? 'bg-violet-600' : 'bg-muted',
                        )}>
                        <span className={cn('inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                          visible ? 'translate-x-3.5' : 'translate-x-0.5')} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Pinned items in your sidebar override hiding — pin a hidden item and it stays visible at the top.
      </p>
    </div>
  );
}
