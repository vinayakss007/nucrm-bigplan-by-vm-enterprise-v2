/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// #1969: symbolic DDL replay + post-stamp verification, shared with scripts/migrate.ts
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

function stripDollarQuoted(text: string): string {
  // Dynamic DDL inside DO $$ ... $$ blocks can't be evaluated
  // statically; exclude those spans from the object census.
  const noBlocks = text.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  // Comments can mention DDL verbs; strip them before matching.
  return noBlocks
    .replace(/--[^\n]*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const ID = String.raw`(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?"?[a-zA-Z_][a-zA-Z0-9_]*"?`;
const IDG = `(${ID})`;

function unquote(id: string): string {
  return (id.split('.').pop() ?? id).replace(/"/g, '').toLowerCase();
}

interface ExpectedSchema {
  tables: Set<string>;
  columns: Map<string, Set<string>>;
}

export function collectExpectedSchema(
  entries: { tag: string }[],
  migrationsDir: string,
): ExpectedSchema {
  const tables = new Set<string>();
  const columns = new Map<string, Set<string>>();
  const addTable = (t: string) => {
    tables.add(t);
    if (!columns.has(t)) columns.set(t, new Set());
  };
  const dropTable = (t: string) => {
    tables.delete(t);
    columns.delete(t);
  };

  for (const entry of entries) {
    const file = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) continue;
    const text = stripDollarQuoted(fs.readFileSync(file, 'utf8'));

    for (const m of text.matchAll(new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDG}`, 'gi'))) {
      addTable(unquote(m[1]!));
    }
    for (const m of text.matchAll(new RegExp(String.raw`DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${IDG}`, 'gi'))) {
      dropTable(unquote(m[1]!));
    }
    for (const m of text.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?${IDG}\s+RENAME\s+TO\s+${IDG}`, 'gi'))) {
      const from = unquote(m[1]!);
      const to = unquote(m[2]!);
      if (tables.delete(from)) {
        addTable(to);
        const cols = columns.get(from);
        columns.delete(from);
        if (cols) columns.set(to, cols);
      }
    }
    for (const m of text.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?${IDG}\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDG}`, 'gi'))) {
      columns.get(unquote(m[1]!))?.add(unquote(m[2]!));
    }
    for (const m of text.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?${IDG}\s+RENAME\s+COLUMN\s+${IDG}\s+TO\s+${IDG}`, 'gi'))) {
      const cols = columns.get(unquote(m[1]!));
      if (cols && cols.delete(unquote(m[2]!))) cols.add(unquote(m[3]!));
    }
    for (const m of text.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?${IDG}\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?${IDG}`, 'gi'))) {
      columns.get(unquote(m[1]!))?.delete(unquote(m[2]!));
    }
  }
  return { tables, columns };
}

export async function verifyStampedSchema(
  execute: (q: ReturnType<typeof sql.raw>) => Promise<{ rows: { table_name: string; column_name: string }[] }>,
  expected: ExpectedSchema,
): Promise<string[]> {
  const res = await execute(sql.raw(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  ));
  const actual = new Map<string, Set<string>>();
  for (const row of res.rows) {
    const t = String(row.table_name).toLowerCase();
    if (!actual.has(t)) actual.set(t, new Set());
    actual.get(t)!.add(String(row.column_name).toLowerCase());
  }
  const missing: string[] = [];
  for (const t of [...expected.tables].sort()) {
    if (!actual.has(t)) {
      missing.push(`table ${t}`);
      continue;
    }
    for (const c of [...(expected.columns.get(t) ?? [])].sort()) {
      if (!actual.get(t)!.has(c)) missing.push(`column ${t}.${c}`);
    }
  }
  return missing;
}
