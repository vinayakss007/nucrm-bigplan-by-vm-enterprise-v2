'use client';

import { useTranslation, type Locale } from '@/lib/i18n/provider';
import { Globe } from 'lucide-react';

export function LanguageSwitcher() {
  const { locale, setLocale, locales } = useTranslation();

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
        aria-label="Change language"
      >
        <Globe className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{locales[locale]}</span>
      </button>
      <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block w-40 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
        {Object.entries(locales).map(([code, name]) => (
          <button
            key={code}
            onClick={() => setLocale(code as Locale)}
            className={`w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors ${
              locale === code ? 'font-semibold text-violet-600' : ''
            }`}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
