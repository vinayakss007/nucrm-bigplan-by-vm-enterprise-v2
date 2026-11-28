/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { clientLogWarn } from '@/lib/client-logger';
import { fetchJsonSafe } from '@/lib/fetch-json';

interface NamedOption { id: string; name: string }
interface ContactOption { id: string; firstName?: string; lastName?: string; email?: string }
interface FieldOption { fieldKey: string; fieldLabel: string }

function extractArray(body: unknown, ...keys: string[]): unknown[] {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

export function useLeadOptionCatalogues() {
  const [products, setProducts] = useState<NamedOption[]>([]);
  const [services, setServices] = useState<NamedOption[]>([]);
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [customFields, setCustomFields] = useState<FieldOption[]>([]);
  const [segments, setSegments] = useState<NamedOption[]>([]);
  const [sequences, setSequences] = useState<NamedOption[]>([]);
  const [optionErrors, setOptionErrors] = useState<Record<string, string>>({});
  const [retryToken, setRetryToken] = useState(0);

  const readOptions = useCallback(async (
    key: string,
    url: string,
    extract: (body: unknown) => unknown[],
    apply: (value: unknown) => void,
    signal: AbortSignal,
  ) => {
    const result = await fetchJsonSafe<unknown>(url, { signal });
    if (result.status === 'aborted') return;
    if (result.status === 'ok') {
      apply(extract(result.data));
      setOptionErrors(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setOptionErrors(prev => ({ ...prev, [key]: result.message }));
      clientLogWarn('leads-client', `Failed to load ${key}`, new Error(result.message));
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    const read = (key: string, url: string, extract: (body: unknown) => unknown[], apply: (value: unknown) => void) =>
      void readOptions(key, url, extract, apply, abort.signal);
    read('custom fields', '/api/tenant/custom-fields?entityType=lead', b => extractArray(b, 'fields'), v => setCustomFields(v as FieldOption[]));
    read('segments', '/api/tenant/segments?entity_type=lead', b => extractArray(b, 'data'), v => setSegments(v as NamedOption[]));
    read('sequences', '/api/tenant/sequences', b => extractArray(b, 'data'), v => setSequences(v as NamedOption[]));
    read('products', '/api/tenant/products?limit=200', b => extractArray(b, 'data'), v => setProducts(v as NamedOption[]));
    read('services', '/api/tenant/services?limit=200', b => extractArray(b, 'data', 'services'), v => setServices(v as NamedOption[]));
    read('contacts', '/api/tenant/contacts?limit=200', b => extractArray(b, 'data'), v => setContactOptions(v as ContactOption[]));
    return () => abort.abort();
  }, [readOptions, retryToken]);

  return {
    products, services, contactOptions, customFields, segments, sequences,
    optionErrors,
    retry: () => setRetryToken(n => n + 1),
  };
}
