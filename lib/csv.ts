/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Pure, browser-safe CSV escaping (#2340).
 *
 * Single source of truth for spreadsheet-formula-injection neutralisation,
 * deliberately dependency-free: lib/export/index.ts imports the db driver and
 * the job queue, so client components could not reuse its escapeCSV and each
 * "Export CSV" button hand-rolled the quoting half — silently dropping the
 * guard half. Both server endpoints (via escapeCSV) and client pages (via
 * csvRow/csvEscapeValue) now share this module.
 *
 * A cell whose FIRST character is one of FORMULA_PREFIXES gets a leading
 * apostrophe so Excel/Sheets/LibreOffice treat it as text, except genuine
 * signed numbers (-500, +1-555-style amounts) which would be mangled.
 */

/** Characters that trigger formula/DDE execution when a CSV cell is opened. */
export const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function csvEscapeValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str: string;
  if (val instanceof Date) {
    str = val.toISOString();
  } else if (typeof val === 'object') {
    // JSONB / array cells must round-trip as data, not "[object Object]".
    try {
      str = JSON.stringify(val);
    } catch {
      str = String(val);
    }
  } else {
    str = String(val);
  }

  if (str.length > 0 && FORMULA_PREFIXES.includes(str[0]!)) {
    const trimmed = str.trim();
    if (!/^[+-]?\d/.test(trimmed)) {
      str = "'" + str;
    }
  }

  // \r is quoted as well as \n: a lone CR splits rows for Excel-on-Mac and
  // for several parsers, corrupting the sheet structure (#2340 site 4).
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** One CSV record: every value escaped, joined with field separators. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvEscapeValue).join(',');
}
