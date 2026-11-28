import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/critical-data-capture.ts'), 'utf8');
const start = src.indexOf('async captureBeforeDelete');
const end = src.indexOf('async captureBeforeUpdate');
const method = src.slice(start, end);

describe('critical-data capture batching (#4067 follow-up)', () => {
  it('reads all deleted records with one ANY() query', () => {
    expect(method).toContain('WHERE id = ANY(${recordIds})');
    expect(method).not.toContain('for (const recordId of recordIds)');
  });

  it('writes all backup rows in one insert', () => {
    expect(method).toContain('.values(values)');
    expect(method).toContain('isJsonRecord(rowData)');
    expect(method).toContain('operation: \'delete\' as const');
  });
});
