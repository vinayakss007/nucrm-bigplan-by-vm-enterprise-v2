/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useTranslation, locales, type Locale } from '@/lib/i18n/provider';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useTranslation();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Globe className="w-4 h-4 text-muted-foreground" />
      <select
        value={locale}
        onChange={e => setLocale(e.target.value as Locale)}
        className="px-2 py-1 rounded-lg border border-border bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
        aria-label="Select language"
      >
        {Object.entries(locales).map(([code, name]) => (
          <option key={code} value={code}>{name}</option>
        ))}
      </select>
    </div>
  );
}
