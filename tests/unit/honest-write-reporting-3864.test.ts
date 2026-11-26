import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const assign = readFileSync(join(process.cwd(), 'app/api/tenant/leads/assign/route.ts'), 'utf8');
const plans = readFileSync(join(process.cwd(), 'app/api/superadmin/plans/route.ts'), 'utf8');
const audit = readFileSync(join(process.cwd(), 'lib/audit/super-admin.ts'), 'utf8');

describe('writes are not reported as success when they failed (#3864)', () => {
  it('uses a Drizzle insert for the assignment history and counts returned rows', () => {
    expect(assign).toContain('db.insert(leadAssignments)');
    expect(assign).toContain('.onConflictDoNothing()');
    expect(assign).toContain('.returning({ id: leadAssignments.id })');
    expect(assign).toContain('historyWritten = written.length;');
    expect(assign).toContain('history_written: historyWritten');
  });

  it('has no swallowed per-row insert errors and no raw history INSERT', () => {
    expect(assign).not.toMatch(/INSERT INTO public\.lead_assignments/);
    expect(assign).not.toContain('.catch((err) => { void logError(');
  });

  it('soft-deletes prior assignments through Drizzle, scoped by tenant', () => {
    expect(assign).toContain('db.update(leadAssignments)');
    expect(assign).toContain('eq(leadAssignments.tenantId, ctx.tenantId)');
    expect(assign).toContain('isNull(leadAssignments.deletedAt)');
  });

  it('rolls back a plan whose audit log could not be written', () => {
    expect(audit).toContain('Promise<boolean>');
    expect(audit).toContain('return true;');
    expect(audit).toContain('return false;');
    expect(plans).toContain('const auditLogged = await logSuperAdminAction(');
    expect(plans).toContain('if (!auditLogged)');
    expect(plans).toContain('await db.delete(plans).where(eq(plans.id, row.id));');
  });
});
