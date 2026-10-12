#!/usr/bin/env npx tsx
/**
 * Live simulation of the console's per-tenant ROLES surface (#29).
 *
 * WHY THIS EXISTS
 * ---------------
 * /superadmin/tenants/[id]/roles used to read /api/tenant/roles, which resolves
 * the tenant from the CALLER's session: the panel listed and edited the super
 * admin's own tenant, and its create/delete buttons posted to routes that were
 * never built. A unit test can prove a handler passes the path id to
 * withTenantContext(); only a run against the live database can prove the row
 * really lands in the tenant named in the URL, and that RLS lets the console get
 * there at all.
 *
 * It drives the SOURCE route modules in-process — the same handlers the image
 * runs — against pre-prod through PgBouncer, authenticated as the real super
 * admin with a minted session. No rebuilt image, no known password.
 *
 * SAFETY
 *   - Writes only into a SIM tenant (name LIKE 'SIM%'), never a real customer's.
 *   - The role it creates is deleted again and the session row it mints is
 *     removed in the same run. Nothing else is touched.
 *   - The minted token is never printed.
 *
 * NOTE on the extension: this must be .ts, not .mts. tsx emits CJS for .ts (the
 * package is not "type":"module") and ESM for .mts, and only the CJS interop
 * survives `export * from './core'` in drizzle/schema/index.ts — under ESM the
 * barrel exposes two names, so every schema import fails to link. Hence the
 * explicit main() instead of top-level await.
 *
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.gate.json --import ./scripts/load-env.mjs \
 *     scripts/sim-superadmin-roles.ts
 *   Add --tenant <uuid> to target a specific SIM tenant.
 */
import { NextRequest } from 'next/server';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { roles, sessions, tenants, users } from '@/drizzle/schema/core';
import { superAdminAuditLogs } from '@/drizzle/schema/super-admin-audit';
import { withSecurityContext, withTenantContext } from '@/lib/db/rls';
import { createToken, hashToken } from '@/lib/auth/session';
import { isUuid } from '@/lib/id';

// Relative to this file: Next rewrites "@/…" at build time, tsx does not.
const COLLECTION = '../app/api/superadmin/tenants/[id]/roles/route';
const ITEM = '../app/api/superadmin/tenants/[id]/roles/[roleId]/route';

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RoleRow = typeof roles.$inferSelect;

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n         ${detail}` : ''}`);
  return ok;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  // The managed endpoint's chain is not verifiable from outside the container
  // network, so take the same route the read-only probes take: the loopback
  // pgbouncer, whose URL carries no sslmode param to override lib/db/ssl-config.ts.
  if (process.env.PROBE_DATABASE_URL) process.env.DATABASE_URL = process.env.PROBE_DATABASE_URL;

  const runStartedAt = new Date();

  // ── 1. Identities ────────────────────────────────────────────────────────
  const sa = await withSecurityContext(async (tx) => {
    const [row] = await tx
      .select({ id: users.id, email: users.email, lastTenantId: users.lastTenantId })
      .from(users)
      .where(eq(users.isSuperAdmin, true))
      .limit(1);
    return row ?? null;
  });
  if (!sa) throw new Error('no super admin account — refusing to run');
  console.log(`super admin: ${sa.email} (tenant ${sa.lastTenantId ?? 'none'})`);

  const wanted = arg('--tenant');
  if (wanted && !isUuid(wanted)) throw new Error('--tenant must be a uuid');

  const target = await withSecurityContext(async (tx) => {
    const [row] = await tx
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(
        wanted
          ? eq(tenants.id, wanted)
          : and(sql`${tenants.name} LIKE 'SIM%'`, isNull(tenants.deletedAt))
      )
      .orderBy(sql`${tenants.createdAt} DESC`)
      .limit(1);
    return row ?? null;
  });
  if (!target) throw new Error('no SIM tenant to write into — refusing to run against a real customer');
  if (target.id === sa.lastTenantId) throw new Error('the newest SIM tenant is the console account itself — pass --tenant');
  console.log(`target tenant: ${target.name} (${target.id})\n`);

  // ── 2. A real session for the real super admin ───────────────────────────
  const token = await createToken(sa.id, 1);
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await withSecurityContext(async (tx) => {
    await tx.insert(sessions).values({ userId: sa.id, tokenHash, expiresAt, ipAddress: '198.51.100.250' });
  });

  async function call(
    which: 'collection' | 'item',
    verb: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    opts: { body?: unknown; roleId?: string } = {}
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const path =
      which === 'collection'
        ? `/api/superadmin/tenants/${target!.id}/roles`
        : `/api/superadmin/tenants/${target!.id}/roles/${opts.roleId}`;
    const request = new NextRequest(`http://127.0.0.1:3000${path}`, {
      method: verb,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.250',
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const mod = (await import(which === 'collection' ? COLLECTION : ITEM)) as Record<string, Handler>;
    const params = which === 'collection' ? { id: target!.id } : { id: target!.id, roleId: opts.roleId! };
    const res = await mod[verb](request, { params: Promise.resolve(params) });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON body */ }
    return { status: res.status, json };
  }

  const rowsOf = (o: Record<string, unknown> | undefined): Record<string, unknown>[] =>
    (o?.data as Record<string, unknown>[] | undefined) ?? [];

  // ── 3. Read: does the console see the TARGET tenant's roles? ─────────────
  const readRoleIds = (tenantId: string) =>
    withTenantContext<string[]>(tenantId, sa!.id, async (tx) => {
      const rows = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), isNull(roles.deletedAt)));
      return rows.map((r) => r.id);
    });

  const truth = await readRoleIds(target.id);
  const consoleTruth = sa.lastTenantId ? await readRoleIds(sa.lastTenantId) : [];

  const listed = await call('collection', 'GET');
  const listedIds = rowsOf(listed.json).map((r) => String(r.id));
  check('GET answers 200', listed.status === 200, `status=${listed.status} ${JSON.stringify(listed.json).slice(0, 160)}`);
  check(
    'GET returns exactly the tenant in the PATH',
    listedIds.length === truth.length && truth.every((id) => listedIds.includes(id)),
    `panel=${listedIds.length} target-tenant=${truth.length}`
  );
  if (consoleTruth.length > 0 && consoleTruth.join() !== truth.join()) {
    check(
      "GET does NOT return the console account's own roles",
      !consoleTruth.some((id) => listedIds.includes(id)),
      `console-tenant roles=${consoleTruth.length}`
    );
  }
  const first = rowsOf(listed.json)[0];
  check(
    'GET carries is_system and a member count',
    !!first && 'is_system' in first && typeof first.user_count === 'number',
    first ? JSON.stringify(Object.keys(first)) : 'no rows'
  );

  // ── 4. Create ────────────────────────────────────────────────────────────
  const nonce = Date.now().toString(36).slice(-5);
  const roleName = `SIM Auditor ${nonce}`;
  const created = await call('collection', 'POST', {
    body: {
      name: roleName,
      description: 'Created by the roles simulation',
      permissions: { 'deals.view': true },
    },
  });
  const createdRow = created.json.data as Record<string, unknown> | undefined;
  const newRoleId = String(createdRow?.id ?? '');
  check('POST creates with 201', created.status === 201, `status=${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
  check(
    'the new role belongs to the target tenant',
    createdRow?.tenantId === target.id,
    `role.tenantId=${String(createdRow?.tenantId)} target=${target.id}`
  );

  const duplicate = await call('collection', 'POST', { body: { name: roleName } });
  check('POST of the same name answers 409', duplicate.status === 409, `status=${duplicate.status}`);

  const badRequest = new NextRequest('http://127.0.0.1:3000/api/superadmin/tenants/not-a-uuid/roles', {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  const collection = (await import(COLLECTION)) as Record<string, Handler>;
  const badRes = await collection.GET(badRequest, { params: Promise.resolve({ id: 'not-a-uuid' }) });
  check('a non-uuid tenant segment answers 400, not 500', badRes.status === 400, `status=${badRes.status}`);

  // ── 5. Patch: permissions only must not rewrite the row ──────────────────
  const readRole = (roleId: string) =>
    withTenantContext<RoleRow | null>(target.id, sa!.id, async (tx) => {
      const [row] = await tx.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      return row ?? null;
    });

  const before = await readRole(newRoleId);
  const patched = await call('item', 'PATCH', {
    roleId: newRoleId,
    body: { permissions: { 'deals.view': true, 'leads.view': true } },
  });
  check('PATCH permissions-only answers 200', patched.status === 200, `status=${patched.status} ${JSON.stringify(patched.json).slice(0, 200)}`);
  const after = await readRole(newRoleId);
  check(
    'PATCH kept the name and description it was not asked to change',
    after?.name === before?.name && after?.description === before?.description,
    `name=${String(after?.name)} description=${String(after?.description)}`
  );
  check(
    'PATCH applied the permissions',
    Object.keys((after?.permissions as Record<string, boolean>) ?? {}).length === 2,
    JSON.stringify(after?.permissions)
  );
  const emptyPatch = await call('item', 'PATCH', { roleId: newRoleId, body: {} });
  check('PATCH with no fields is refused', emptyPatch.status === 400, `status=${emptyPatch.status}`);

  // ── 6. System roles cannot be deleted from the console ───────────────────
  const systemRole = await withTenantContext<{ id: string; slug: string } | null>(target.id, sa.id, async (tx) => {
    const [row] = await tx
      .select({ id: roles.id, slug: roles.slug })
      .from(roles)
      .where(and(eq(roles.tenantId, target.id), sql`${roles.slug} = 'admin'`, isNull(roles.deletedAt)))
      .limit(1);
    return row ?? null;
  });
  if (systemRole) {
    const refused = await call('item', 'DELETE', { roleId: systemRole.id });
    check('DELETE of the tenant admin role is refused', refused.status === 400, `status=${refused.status}`);
    const stillThere = await readRole(systemRole.id);
    check('the refused delete wrote nothing', !!stillThere && stillThere.deletedAt === null, `deletedAt=${String(stillThere?.deletedAt)}`);
  } else {
    console.log('  SKIP  system-role refusal\n         the target tenant has no admin role to try');
  }

  // ── 7. Delete the role we made, then prove it is gone ────────────────────
  const removed = await call('item', 'DELETE', { roleId: newRoleId });
  check('DELETE of a custom role answers 200', removed.status === 200, `status=${removed.status}`);
  const softDeleted = await readRole(newRoleId);
  check('the deleted role is soft-deleted, not erased', !!softDeleted && softDeleted.deletedAt !== null, `deletedAt=${String(softDeleted?.deletedAt)}`);
  const afterDelete = await call('collection', 'GET');
  check('the deleted role leaves the list', !rowsOf(afterDelete.json).some((r) => String(r.id) === newRoleId));

  // ── 8. The audit trail recorded all three actions ────────────────────────
  const auditRows = await withSecurityContext(async (tx) =>
    tx
      .select({ action: superAdminAuditLogs.action, targetId: superAdminAuditLogs.targetId })
      .from(superAdminAuditLogs)
      .where(and(eq(superAdminAuditLogs.targetId, target.id), gte(superAdminAuditLogs.createdAt, runStartedAt)))
  );
  const actions = auditRows.map((r) => r.action);
  check(
    'role.created / role.updated / role.deleted are audited against the TARGET tenant',
    ['role.created', 'role.updated', 'role.deleted'].every((a) => actions.includes(a)),
    `rows=${JSON.stringify(actions)}`
  );

  // ── 9. Tear down the minted session ──────────────────────────────────────
  try {
    await withSecurityContext(async (tx) => {
      await tx.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    });
  } catch (err) {
    console.log(`  ..   could not remove the minted session: ${(err as Error).message}`);
  }
  const leftover = await withSecurityContext(async (tx) =>
    tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.tokenHash, tokenHash))
  );
  check('the minted session is removed', leftover.length === 0, `rows=${leftover.length}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nroles simulation aborted: ${(err as Error)?.message ?? err}`);
  process.exit(1);
});
