'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Settings as SettingsIcon } from 'lucide-react';
import { findCurrent } from './settings-config';

/**
 * Auto-generated breadcrumb derived from the active route + settings-config.
 * Shown above every settings page so users always know where they are.
 */
export default function SettingsBreadcrumb() {
  const pathname = usePathname();
  const current = findCurrent(pathname);

  // Don't render on the index — the page has its own header
  if (pathname === '/tenant/settings' || pathname === '/tenant/settings/') return null;
  if (!current) {
    return (
      <nav className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-3" aria-label="Breadcrumb">
        <Link href="/tenant/settings" className="hover:text-foreground inline-flex items-center gap-1">
          <SettingsIcon className="w-3 h-3" /> Settings
        </Link>
      </nav>
    );
  }

  const ScopeIcon = current.scope.icon;
  return (
    <nav className="flex items-center gap-1 text-[11px] text-muted-foreground mb-3 overflow-x-auto scrollbar-thin whitespace-nowrap" aria-label="Breadcrumb">
      <Link href="/tenant/settings" className="hover:text-foreground inline-flex items-center gap-1 shrink-0">
        <SettingsIcon className="w-3 h-3" /> Settings
      </Link>
      <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <span className="inline-flex items-center gap-1 shrink-0">
        <ScopeIcon className="w-3 h-3" />
        {current.scope.label}
      </span>
      <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <span className="shrink-0">{current.group.label}</span>
      <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <span className="font-semibold text-foreground truncate">{current.item.label}</span>
    </nav>
  );
}
