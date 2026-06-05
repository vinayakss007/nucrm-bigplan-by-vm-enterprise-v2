'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import en from './locales/en.json';

type TranslationValue = string | ((...args: string[]) => string);
type TranslationDict = Record<string, unknown>;

type Locale = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ja' | 'zh';

const locales: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ja: '日本語',
  zh: '中文',
};

const defaultLocale: Locale = 'en';
const localeFiles: Record<Locale, () => Promise<TranslationDict>> = {
  en: async () => en as TranslationDict,
  es: async () => (await import('./locales/es.json')).default as TranslationDict,
  fr: async () => ({}),
  de: async () => ({}),
  pt: async () => ({}),
  ja: async () => ({}),
  zh: async () => ({}),
};

function getNestedValue(obj: TranslationDict, path: string): TranslationValue | TranslationDict | undefined {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current as TranslationValue | TranslationDict | undefined;
}

function interpolate(value: TranslationValue, params?: Record<string, string>): string {
  if (typeof value === 'function') {
    return value(...(params ? Object.values(params) : []));
  }
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? `{{${key}}}`);
}

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  locales: Record<Locale, string>;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [translations, setTranslations] = useState<TranslationDict>(en as TranslationDict);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('nucrm_locale') : null;
    if (saved && saved in locales) {
      setLocaleState(saved as Locale);
    }
  }, []);

  const setLocale = useCallback(async (newLocale: Locale) => {
    setLocaleState(newLocale);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nucrm_locale', newLocale);
      document.documentElement.lang = newLocale;
    }
    if (newLocale !== defaultLocale) {
      const loader = localeFiles[newLocale];
      if (loader) {
        const data = await loader();
        setTranslations({ ...(en as TranslationDict), ...data });
      }
    } else {
      setTranslations(en as TranslationDict);
    }
  }, []);

  const t = useCallback((key: string, params?: Record<string, string>): string => {
    const value = getNestedValue(translations, key);
    if (typeof value === 'string') {
      return interpolate(value, params);
    }
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[i18n] Missing translation for key: ${key}`);
    }
    return key;
  }, [translations]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, locales }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
}

export { locales, defaultLocale };
export type { Locale };
