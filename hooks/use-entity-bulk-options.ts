/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { clientLogWarn } from '@/lib/client-logger';
import { fetchJsonSafe } from '@/lib/fetch-json';

export interface FieldOption { fieldKey: string; fieldLabel: string }
export interface NamedOption { id: string; name: string }

function extractArray(body: unknown, key: string): unknown[] {
  if (body && typeof body === 'object' && key in body) {
    const value = (body as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function useEntityBulkOptions(entityType: 'contact' | 'company' | 'deal' | 'task') {
  const [customFields, setCustomFields] = useState<FieldOption[]>([]);
  const [segments, setSegments] = useState<NamedOption[]>([]);
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
      clientLogWarn('bulk-options', `Failed to load ${key}`, new Error(result.message));
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void readOptions('custom fields', `/api/tenant/custom-fields?entityType=${entityType}`,
      b => extractArray(b, 'fields'),
      v => setCustomFields(v as FieldOption[]), abort.signal);
    void readOptions('segments', `/api/tenant/segments?entity_type=${entityType}`,
      b => extractArray(b, 'data'),
      v => setSegments(v as NamedOption[]), abort.signal);
    return () => abort.abort();
  }, [readOptions, retryToken, entityType]);

  return {
    customFields,
    segments,
    optionErrors,
    retry: () => setRetryToken(n => n + 1),
  };
}
