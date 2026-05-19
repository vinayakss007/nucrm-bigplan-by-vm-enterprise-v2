'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href:'/tenant/settings/profile',  label:'My Profile' },
  { href:'/tenant/settings/general',  label:'Workspace' },
  { href:'/tenant/settings/team',     label:'Team' },
  { href:'/tenant/settings/billing',  label:'Plan & Billing' },
  { href:'/tenant/settings/admin',    label:'Org Admin', adminOnly:true },
  { href:'/tenant/settings/security', label:'Security & 2FA' },
  { href:'/tenant/settings/roles',    label:'Roles', adminOnly:true },
  { href:'/tenant/settings/sessions', label:'Sessions' },
  { href:'/tenant/settings/api-keys', label:'API Keys', adminOnly:true },
  { href:'/tenant/settings/audit',    label:'Audit Log', adminOnly:true },
  { href:'/tenant/settings/email',         label:'Email' },
  { href:'/tenant/settings/integrations',  label:'Integrations' },
  { href:'/tenant/settings/pipelines',     label:'Pipelines', adminOnly:true },
  { href:'/tenant/settings/webhooks',      label:'Webhooks' },
  { href:'/tenant/settings/custom-fields', label:'Custom Fields', adminOnly:true },
  { href:'/tenant/settings/industry-templates', label:'Templates' },
  { href:'/tenant/settings/portal',        label:'Portal', adminOnly:true },
  { href:'/tenant/settings/backup',        label:'Backup', adminOnly:true },
  { href:'/tenant/settings/telegram',      label:'Telegram' },
];

export default function SettingsNav() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch('/api/tenant/me')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setIsAdmin(d.is_admin ?? false))
      .catch(() => {});
  }, []);

  const visible = ITEMS.filter(i => !i.adminOnly || isAdmin);

  return (
    <div className="w-full overflow-x-auto scrollbar-thin -mx-1 px-1">
      <div className="flex gap-1 pb-2 border-b border-border min-w-max">
        {visible.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link key={item.href} href={item.href}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                active
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}>
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
