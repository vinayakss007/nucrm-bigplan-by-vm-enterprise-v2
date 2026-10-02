/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * One canonical wire shape for custom-report filters.
 *
 * `/api/tenant/reports/run` reads filters as a record keyed by column, whose
 * value is either a bare string (meaning `equals`) or `{ value, op }`. The
 * builder page keeps its own array of `{ column, op, value }` rows for the UI,
 * and used to post *that array* to `/api/tenant/reports/custom` when saving.
 * Nothing reconciled the two, so a saved report came back in a shape the run
 * endpoint cannot read, and the operator a customer picked — "contains", "in",
 * "greater than" — was gone.
 *
 * The array form still has to be understood: reports saved before this existed
 * are stored that way in `platform_settings`.
 */

export interface ReportFilterRow {
  column: string;
  op: string;
  value: string;
}

export type StoredFilterValue = string | { value?: string; op?: string };

/** column → value, or column → { value, op }. What the API and storage speak. */
export type StoredFilters = Record<string, StoredFilterValue>;

/**
 * The operators the builder offers, in the order it offers them. `equals` is the
 * fallback for anything else, because `/reports/run` treats an operator it does
 * not recognise as equality — so a stored `nope` would be displayed as one thing
 * and run as another.
 */
export const REPORT_FILTER_OPS = [
  { id: 'equals', label: 'Equals' },
  { id: 'contains', label: 'Contains' },
  { id: 'gt', label: 'Greater than' },
  { id: 'lt', label: 'Less than' },
  { id: 'in', label: 'In' },
] as const;

const KNOWN_OPS = new Set<string>(REPORT_FILTER_OPS.map(op => op.id));

/** Drops blank-value rows: an empty box means "no filter on this column". */
export function toStoredFilters(filters: ReportFilterRow[]): StoredFilters {
  return filters.reduce<StoredFilters>((acc, f) => {
    if (f.value) acc[f.column] = { value: f.value, op: f.op };
    return acc;
  }, {});
}

export function fromStoredFilters(stored: unknown): ReportFilterRow[] {
  if (!stored) return [];
  const entries: [string, StoredFilterValue][] = Array.isArray(stored)
    // [{ column, op, value }] — the legacy save shape. Object.entries() of an
    // array would hand back "0", "1" as the column name, so it is unpacked here.
    ? (stored as Partial<ReportFilterRow>[]).map(
      row => [String(row?.column ?? ''), { value: row?.value, op: row?.op }]
    )
    : Object.entries(stored as StoredFilters);
  return entries
    .filter(([column]) => column !== '')
    .map(([column, raw]) => ({
      column,
      op: typeof raw === 'object' && raw !== null && typeof raw.op === 'string' && KNOWN_OPS.has(raw.op)
        ? raw.op
        : 'equals',
      value: typeof raw === 'object' && raw !== null ? String(raw.value ?? '') : String(raw ?? ''),
    }));
}

/**
 * A value that arrived as a serialized timestamp. Testing for a capital "T"
 * instead matched every title, name and domain containing one and rendered it
 * as an em dash, because `formatDate` turns an unparseable string into a dash.
 */
export function isTimestampColumnValue(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}
