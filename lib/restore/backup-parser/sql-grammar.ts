/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The SQL grammar of a pg_dump INSERT line, split out of
 * lib/restore/backup-parser.ts under #422. This module owns "how a table name,
 * column list, and value row are recognised"; the parser, the verifier and the
 * restore executor all build their regexes from here so the grammar cannot
 * drift apart again.
 */

export interface ParsedStatement {
  table: string;
  columns: string[];
  values: string[];
  rawStatement: string;
}

/** An INSERT decomposed into its table, columns and every VALUES row. */
export interface ParsedInsertRows {
  table: string;
  columns: string[];
  /** One entry per VALUES group, so a multi-row INSERT yields several. */
  rows: string[][];
}

/**
 * A single SQL identifier as pg_dump can emit it: either a bare word
 * (`contacts`) or a double-quoted identifier, which may contain a doubled
 * `""` escape (`"Contacts"`, `"odd""name"`).
 *
 * pg_dump emits quoted identifiers whenever a name is mixed-case, reserved or
 * contains punctuation — and always when run with --quote-all-identifiers.
 */
const SQL_IDENTIFIER = String.raw`(?:"(?:[^"]|"")*"|\w+)`;

/**
 * Regex source for an optionally schema-qualified table reference, with the
 * TABLE (not the schema) as its single capture group. Still carries the quotes
 * if the source quoted them — run the capture through `unquoteIdentifier()`.
 *
 * Matches: contacts | public.contacts | "contacts" | "Contacts"
 *        | "public"."contacts" | public."Contacts" | crm.contacts
 *
 * This is the single source of truth for "how do we recognise a table name in
 * an INSERT"; the parser, the verifier and the restore executor all build
 * their regexes from it via `buildInsertIntoRegex()` so it cannot drift again.
 */
export const TABLE_REFERENCE_PATTERN =
  String.raw`(?:${SQL_IDENTIFIER}\s*\.\s*)?(${SQL_IDENTIFIER})`;

/**
 * Build a case-insensitive `INSERT INTO <table-reference>` regex.
 *
 * Capture group 1 is always the (possibly quoted) table name; any capture
 * groups inside `tail` therefore start at 2.
 */
export function buildInsertIntoRegex(
  tail: string,
  options?: { anchored?: boolean }
): RegExp {
  const head = options?.anchored ? String.raw`^\s*` : '';
  return new RegExp(
    `${head}INSERT\\s+INTO\\s+${TABLE_REFERENCE_PATTERN}${tail}`,
    'i'
  );
}

/**
 * Strip the surrounding double quotes from a SQL identifier, collapsing the
 * doubled-quote escape: `"Contacts"` -> `Contacts`, `"a""b"` -> `a"b`.
 * A bare identifier is returned unchanged.
 */
export function unquoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

/** Matches a line that is meant to be an INSERT, whether or not it parses. */
const INSERT_LINE_PATTERN = /^\s*INSERT\s+INTO\s/i;

/**
 * True if the line is an attempted `INSERT INTO ...`. Used to tell "not an
 * INSERT at all" (a comment, a SET, a COPY) apart from "an INSERT we failed to
 * parse" — the latter is data loss and must be reported, not skipped.
 */
export function looksLikeInsertStatement(line: string): boolean {
  return INSERT_LINE_PATTERN.test(line);
}

/** Table name of an INSERT, unquoted and stripped of any schema prefix. */
export function parseTableReference(line: string): string | null {
  const match = line.match(buildInsertIntoRegex(''));
  return match?.[1] ? unquoteIdentifier(match[1]) : null;
}

/**
 * Full shape of a single-line INSERT: table reference, column list, VALUES
 * clause. Group 1 = table, 2 = columns, 3 = everything after VALUES.
 *
 * `VALUES\s*` (not `\s+`) so that `VALUES('c1','Bob')` — emitted by some
 * dump tools and by hand-written fixtures — is accepted. The `VALUES` keyword
 * is anchored to the closing paren of the column list, so a column named
 * `values_count` cannot be mistaken for it.
 */
const INSERT_STATEMENT_TAIL = String.raw`\s*\(([^)]+)\)\s*VALUES\s*(.+);?\s*$`;

/**
 * Extract the raw VALUES clause of an INSERT (all row groups, including the
 * trailing `;` that the greedy capture keeps — downstream group parsing
 * tolerates it).
 */
export function extractValuesClause(line: string): string | null {
  const match = line.match(buildInsertIntoRegex(INSERT_STATEMENT_TAIL));
  return match?.[3] ?? null;
}

/**
 * Parse an INSERT into its table, columns and ALL of its value rows.
 *
 * This is the single entry point anything needing per-row access should use.
 * `parseInsertStatement` exposes only the first row for backwards
 * compatibility; consumers that reimplemented their own value scanner (the
 * verifier used to) drifted from this one and broke — see the tenant_id
 * extraction defect fixed alongside this.
 */
export function parseInsertRows(line: string): ParsedInsertRows | null {
  const match = line.match(buildInsertIntoRegex(INSERT_STATEMENT_TAIL));
  if (!match?.[1] || !match[2] || !match[3]) return null;

  const columns = parseColumnNames(match[2]);
  const rows = parseValueGroups(match[3]).filter(r => r.length === columns.length);
  if (rows.length === 0) return null;

  return { table: unquoteIdentifier(match[1]), columns, rows };
}

/**
 * Parse a single INSERT statement into structured data.
 * Supports both single-row and multi-row INSERTs:
 *   INSERT INTO t (a, b) VALUES (1, 2);
 *   INSERT INTO t (a, b) VALUES (1, 2), (3, 4), (5, 6);
 * Quoted and schema-qualified table names are accepted; the returned `table`
 * is always unquoted and unqualified (`public."Contacts"` -> `Contacts`).
 */
export function parseInsertStatement(line: string): ParsedStatement | null {
  // Match: INSERT INTO table_name (col1, col2, ...) VALUES (...);
  const match = line.match(buildInsertIntoRegex(INSERT_STATEMENT_TAIL));

  if (!match) return null;

  const table = unquoteIdentifier(match[1]!);
  const columnsStr = match[2]!;
  const valuesStr = match[3]!;
  const columns = parseColumnNames(columnsStr);

  // Parse ALL value groups (supports multi-row INSERTs)
  const allValueGroups = parseValueGroups(valuesStr);
  if (allValueGroups.length === 0) return null;

  // EVERY row must match the column list, not just the first. Checking only
  // row 1 let a malformed later row through, which then failed at execute time
  // and was merely console.error'd — so the restore reported success with a
  // record missing. Rejecting the statement makes it countable as unparsed
  // instead, which is surfaced to the caller.
  if (allValueGroups.some(group => group.length !== columns.length)) return null;

  // For compatibility, return first value group as `values`
  // Multi-row handling is done in the backup file parser
  const values = allValueGroups[0];
  if (!values) return null;

  return { table, columns, values, rawStatement: line };
}

/**
 * Parse multiple value groups from INSERT VALUES clause.
 * Handles: (val1, val2), (val3, val4), (val5, val6)
 * Returns array of value arrays (one per row)
 */
export function parseValueGroups(valuesStr: string): string[][] {
  const groups: string[][] = [];
  let currentGroup = '';
  let inQuotes = false;
  let escapeNext = false;
  let depth = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (escapeNext) {
      currentGroup += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      currentGroup += char;
      escapeNext = true;
      continue;
    }

    if (char === "'") {
      inQuotes = !inQuotes;
      currentGroup += char;
      continue;
    }

    if (!inQuotes) {
      if (char === '(') {
        depth++;
        currentGroup += char;
        continue;
      }
      if (char === ')') {
        depth--;
        currentGroup += char;
        // When depth reaches 0, we've completed a value group
        if (depth === 0) {
          const trimmed = currentGroup.trim();
          // Remove outer parentheses and parse values
          const inner = trimmed.slice(1, -1);
          if (inner) {
            groups.push(parseValues(inner));
          }
          currentGroup = '';
        }
        continue;
      }
      if (char === ',' && depth === 0) {
        // Separator between value groups — skip
        continue;
      }
    }

    currentGroup += char;
  }

  // Handle any remaining (single-row case without outer parens in some dumps)
  if (currentGroup.trim() && groups.length === 0) {
    const trimmed = currentGroup.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      const inner = trimmed.slice(1, -1);
      groups.push(parseValues(inner));
    }
  }

  return groups;
}

/**
 * Parse column names from "(col1, col2, col3)"
 */
export function parseColumnNames(columnsStr: string): string[] {
  return columnsStr.split(',').map(c => c.trim().replace(/"/g, ''));
}

/**
 * Parse SQL values handling quoted strings, NULL, numbers
 */
export function parseValues(valuesStr: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let escapeNext = false;
  /** Depth of unquoted `(`/`[` nesting, so commas inside them are not splits. */
  let nesting = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'") {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    // Track nesting so a comma *inside* a composite value is not treated as a
    // column separator. Without this, `ARRAY[1,2]`, `ROW(1,2)` and
    // `'{"a":1}'::jsonb` style values split into extra columns, the row's arity
    // stops matching the column list, and the whole row is dropped — silent
    // data loss on restore.
    if (!inQuotes && (char === '(' || char === '[')) {
      nesting++;
      current += char;
      continue;
    }
    if (!inQuotes && (char === ')' || char === ']')) {
      if (nesting > 0) nesting--;
      current += char;
      continue;
    }

    if (char === ',' && !inQuotes && nesting === 0) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    values.push(current.trim());
  }

  return values;
}

/**
 * Extract a string value from SQL format (remove quotes)
 */
export function extractStringValue(sqlValue: string): string | null {
  if (!sqlValue || sqlValue === 'NULL' || sqlValue === 'null') return null;
  if (sqlValue.startsWith("'") && sqlValue.endsWith("'")) {
    return sqlValue.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'");
  }
  return null;
}

/**
 * Extract UUID value from SQL format
 */
export function extractUUIDValue(sqlValue: string): string | null {
  const str = extractStringValue(sqlValue);
  if (!str) return null;
  // Basic UUID validation
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str;
  }
  return null;
}

/**
 * Extract timestamp value from SQL format
 */
export function extractTimestampValue(sqlValue: string): string | null {
  if (!sqlValue || sqlValue === 'NULL' || sqlValue === 'null') return null;
  const str = extractStringValue(sqlValue);
  if (str) return str;
  // Could also be a raw timestamp without quotes in some dumps
  return sqlValue;
}
