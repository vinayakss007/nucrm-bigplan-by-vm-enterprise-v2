/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3752 — table search must reach the API (server-side filtering) and
 * page-size changes must trigger a refetch with the new limit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('#3752 task/project search and page-size', () => {
  it('both APIs filter by q with escaped ILIKE on the searchable columns', () => {
    const tasks = read('app/api/tenant/tasks/route.ts');
    const projects = read('app/api/tenant/projects/route.ts');
    for (const [name, src, columns] of [
      ['tasks', tasks, ['tasks.title', 'tasks.description']],
      ['projects', projects, ['projects.name', 'projects.description']],
    ] as const) {
      expect(src, name).toContain("searchParams.get('q')?.trim()");
      for (const col of columns) expect(src, name).toContain(`ilike(${col}, \`%\${escapeLike(q)}%\`)`);
    }
  });

  it('both tables pass filter and size overrides into loadData', () => {
    for (const file of ['components/tenant/tasks-data-table.tsx', 'components/tenant/projects-data-table.tsx']) {
      const src = read(file);
      expect(src, file).toContain('async (page = 0, filterOverride?: string, pageSizeOverride?: number)');
      expect(src, file).toContain("if (q) params.set('q', q)");
      expect(src, file).toContain('loadData(0, filter)');
      expect(src, file).toContain('loadData(0, undefined, size)');
    }
  });
});
