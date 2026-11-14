/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function* walkRouteFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      yield* walkRouteFiles(full);
    } else if (name === 'route.ts' || name === 'route.tsx') {
      yield full;
    }
  }
}

describe('silent catch verification (#3515)', () => {
  it('ensures app/api/tenant/trash/route.ts logs on clearIncludeDeleted rejection', () => {
    const src = readFileSync('app/api/tenant/trash/route.ts', 'utf8');
    expect(src).not.toMatch(/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
    expect(src).toContain("context: 'trash:clearIncludeDeleted GET'");
    expect(src).toContain("context: 'trash:clearIncludeDeleted PATCH'");
    expect(src).toContain("context: 'trash:clearIncludeDeleted DELETE'");
  });

  it('ensures app/api/superadmin/templates/[id]/assign/route.ts logs on installTemplateModules rejection', () => {
    const src = readFileSync('app/api/superadmin/templates/[id]/assign/route.ts', 'utf8');
    expect(src).not.toMatch(/installTemplateModules\([^)]*\)\.catch\(\s*\(\)\s*=>\s*\{/);
    expect(src).toContain("context: 'superadmin/templates/[id]/assign installTemplateModules'");
  });

  it('ensures app/api/tenant/leads/assign/route.ts logs batch insert rejection before fallback', () => {
    const src = readFileSync('app/api/tenant/leads/assign/route.ts', 'utf8');
    expect(src).toContain("context: 'tenant/leads/assign batch-fallback'");
  });

  it('ensures app/api/bug-report/route.ts logs when json parsing fails', () => {
    const src = readFileSync('app/api/bug-report/route.ts', 'utf8');
    expect(src).not.toMatch(/res\.json\(\)\.catch\(\s*\(\)\s*=>\s*undefined\s*\)/);
    expect(src).toContain("context: 'bug-report:json-parse'");
  });

  it('ensures app/api/tenant/ai/models/route.ts logs when text parsing fails', () => {
    const src = readFileSync('app/api/tenant/ai/models/route.ts', 'utf8');
    expect(src).not.toMatch(/res\.text\(\)\.catch\(\s*\(\)\s*=>\s*''\s*\)/);
    expect(src).toContain("context: 'tenant/ai/models:text-parse'");
  });

  it('ensures app/api/cron/backup-verify/route.ts logs on tenants query failure and drop db force fallback', () => {
    const src = readFileSync('app/api/cron/backup-verify/route.ts', 'utf8');
    expect(src).not.toMatch(/scratchPool\.query[^(]*\([^)]*\)\.catch\(\s*\(\)\s*=>\s*null\s*\)/);
    expect(src).toContain("context: 'backup-verify:query-tenants'");
    expect(src).toContain("context: 'backup-verify:drop-force-fallback'");
  });

  it('ensures app/api/tenant/forms/[id]/analytics/route.ts logs on readJsonBody error', () => {
    const src = readFileSync('app/api/tenant/forms/[id]/analytics/route.ts', 'utf8');
    expect(src).not.toMatch(/try\s*\{\s*body\s*=\s*await readJsonBody\(req\);\s*\}\s*catch\s*\{\s*\}/);
    expect(src).toContain("context: 'forms/analytics readJsonBody'");
  });

  it('scans all app/api routes for completely unhandled empty catch blocks', () => {
    const violations: { file: string; line: number; snippet: string }[] = [];
    const root = join(process.cwd(), 'app', 'api');

    for (const file of walkRouteFiles(root)) {
      const rel = relative(process.cwd(), file);
      const raw = readFileSync(file, 'utf8');
      // Strip block comments and single line comments for pure code analysis
      const lines = raw.split('\n');

      let inBlockComment = false;
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        if (inBlockComment) {
          if (line.includes('*/')) {
            inBlockComment = false;
            line = line.slice(line.indexOf('*/') + 2).trim();
          } else {
            continue;
          }
        }

        if (line.startsWith('/*')) {
          if (line.includes('*/')) {
            line = line.slice(line.indexOf('*/') + 2).trim();
          } else {
            inBlockComment = true;
            continue;
          }
        }

        if (line.startsWith('//') || line.startsWith('*')) {
          continue;
        }

        // Flag literal empty .catch(() => {}) or catch {} without comment or body
        if (/\.catch\(\s*(?:\(\s*\)|[a-zA-Z0-9_]+)\s*=>\s*\{\s*\}\s*\)/.test(line)) {
          violations.push({ file: rel, line: i + 1, snippet: line });
        }
        if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line)) {
          violations.push({ file: rel, line: i + 1, snippet: line });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
