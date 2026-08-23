/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Core i18n module for NuCRM
 *
 * Provides server-side internationalization with support for
 * English, Hindi, and Marathi locales.
 */

import { en, type TranslationKeys } from './locales/en';
import { hi } from './locales/hi';
import { mr } from './locales/mr';

export type Locale = 'en' | 'hi' | 'mr';

type TranslationNamespace = Record<string, string>;
type Translations = Record<string, TranslationNamespace>;

const translations: Record<Locale, Translations> = {
  en: en as unknown as Translations,
  hi: hi as unknown as Translations,
  mr: mr as unknown as Translations,
};

/**
 * Returns the translations object for a given locale and namespace.
 * Falls back to English if the locale or namespace is not found.
 */
export function getTranslations(
  locale: Locale,
  namespace: string,
): Record<string, string> {
  const localeData = translations[locale] ?? translations.en;
  const ns = (localeData as Record<string, unknown>)[namespace];
  if (ns && typeof ns === 'object') {
    return ns as Record<string, string>;
  }
  // Fallback to English namespace
  const fallback = (translations.en as Record<string, unknown>)[namespace];
  if (fallback && typeof fallback === 'object') {
    return fallback as Record<string, string>;
  }
  return {};
}

/**
 * Translate a dot-notated key with optional parameter interpolation.
 * Falls back to the English translation if the key is not found in
 * the requested locale.
 *
 * Interpolation uses {{param}} syntax:
 *   t('common.welcome', 'hi', { name: 'Rahul' })
 *   // => 'स्वागत है, Rahul'
 */
export function t(
  key: string,
  locale: Locale,
  params?: Record<string, string>,
): string {
  const value = resolveKey(key, locale) ?? resolveKey(key, 'en');
  if (value === undefined) {
    return key;
  }
  if (!params) return value;
  return interpolate(value, params);
}

/**
 * Format a currency amount with locale-aware formatting.
 * Defaults to INR for hi/mr locales and USD for en.
 * Uses Indian numbering system (lakhs/crores) for INR.
 */
export function formatCurrency(
  amount: number,
  locale: Locale,
  currency?: string,
): string {
  const resolvedCurrency = currency ?? (locale === 'en' ? 'USD' : 'INR');
  const localeTag = getIntlLocale(locale);
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: resolvedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a date with locale-aware formatting.
 *   - 'short': DD/MM/YYYY for hi/mr, MM/DD/YYYY for en
 *   - 'long': full month name with day and year
 */
export function formatDate(
  date: Date,
  locale: Locale,
  format: 'short' | 'long' = 'short',
): string {
  const localeTag = getIntlLocale(locale);
  if (format === 'short') {
    return new Intl.DateTimeFormat(localeTag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }
  return new Intl.DateTimeFormat(localeTag, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Format a number with locale-aware formatting.
 * Uses Indian numbering system (lakhs/crores) for hi/mr locales.
 *   formatNumber(100000, 'hi') => '1,00,000'
 */
export function formatNumber(num: number, locale: Locale): string {
  const localeTag = getIntlLocale(locale);
  return new Intl.NumberFormat(localeTag).format(num);
}

/**
 * Returns the list of supported locales with display labels.
 */
export function getSupportedLocales(): Array<{
  code: Locale;
  label: string;
  nativeLabel: string;
}> {
  return [
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
    { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी' },
  ];
}

// --- Internal helpers ---

function getIntlLocale(locale: Locale): string {
  const map: Record<Locale, string> = {
    en: 'en-US',
    hi: 'hi-IN',
    mr: 'mr-IN',
  };
  return map[locale];
}

function resolveKey(key: string, locale: Locale): string | undefined {
  const parts = key.split('.');
  let current: unknown = translations[locale];
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(value: string, params: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) => {
    return params[paramKey] ?? `{{${paramKey}}}`;
  });
}

export type { TranslationKeys };
