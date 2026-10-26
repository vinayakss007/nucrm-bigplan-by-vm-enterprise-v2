/**
 * #3282 — provision a database from empty, instead of wiping one that is in use.
 *
 * Until this revision the script's name was `npm run prod:seed` and its first act was: count
 * `users`, and if the count was non-zero, `DELETE` from `sessions`, `tenantMembers`, `dealStages`,
 * `pipelines`, `roles`, `users` and `tenants` — with no `NODE_ENV` check, no host check, no
 * confirmation, no `--dry-run`, and no warning. Its only guard read like a guard and was not one:
 * `users` is under FORCE RLS, so counted as the bare app role the query answers `0` on a database
 * holding real tenants (#3280), the cleanup branch is skipped, and the script then inserts a
 * SECOND platform super admin — `admin@nucrm.com` with `is_super_admin = true`, whose password was
 * a literal committed to this public repository — and mints it a 30-day session. Because that user
 * exists,
 * the one-shot window in `app/api/setup/create-admin/route.ts:45` closes permanently, so the
 * operator's own first admin can never be created afterwards.
 *
 * What it is now, in order:
 *   1. resolve the credential from `SEED_PASSWORD` through #3281's `resolveSeedPassword()` — no
 *      fallback, and validated against the application's own four rules before anything connects;
 *   2. name the target (`host:port/dbname`, never the credential in `DATABASE_URL`);
 *   3. refuse on `NODE_ENV=production`, a non-interactive terminal, or an unparseable URL;
 *   4. count what is in it **inside** `set_config('app.is_super_admin','true',true)`, so the count
 *      is the truth rather than zero, and refuse if the answer is `POPULATED`;
 *   5. `--dry-run` rolls the decision transaction back — a refusal and a rehearsal write nothing;
 *   6. ask a human to type the database name when no `--yes` / `NUCRM_ALLOW_PROD_SEED=1` was given;
 *   7. only then delete, seed, and commit.
 *
 * One pinned connection and one transaction, which is the shape #2628 established for
 * `scripts/seed-dev.ts`: `SET LOCAL` ties the bypass to the transaction, so COMMIT or ROLLBACK
 * ends it, and no half-written state survives a refusal.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createInterface } from 'node:readline';
import { eq } from 'drizzle-orm';

import * as schema from '@/drizzle/schema';
import { users, tenants, tenantMembers, roles, sessions, pipelines, dealStages } from '@/drizzle/schema';
import { hashPassword, createToken, hashToken } from '@/lib/auth/session';

import { resolveSeedPassword, SEED_PASSWORD_ENV } from './seed/credential';
import { classify, formatVerdict } from './seed/contents';
import { refusal, describeTarget, formatTarget, parseFlags, confirmationMatches } from './seed/destructive';
import { STATE_SQL, readStateCounts } from './seed/state';

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const target = describeTarget(process.env.DATABASE_URL);
  const yes = flags.yes || process.env.NUCRM_ALLOW_PROD_SEED === '1';
  const interactive = Boolean(process.stdin.isTTY) && process.env.CI !== 'true';
  const production = process.env.NODE_ENV === 'production';
  const effect = 'deletes every user, tenant, role, session, pipeline and deal stage in the target database';

  console.log('[seed-fresh] target: ' + formatTarget(target));
  console.log('[seed-fresh] effect: ' + effect);

  const credential = resolveSeedPassword(process.env);
  if (credential.error) {
    console.error(`[seed-fresh] REFUSING: ${credential.error}`);
    process.exit(1);
  }
  const seedPassword = credential.password as string;

  // Phase 1 — the rules that need no connection. A target we cannot name, a production
  // environment, or a terminal nobody is watching are all reasons to stop before the first
  // packet leaves the process.
  const early = refusal({
    script: 'seed-fresh',
    effect,
    target,
    state: 'EMPTY',
    production,
    yes,
    interactive,
    wipe: false,
  });
  if (early) {
    console.error(`[seed-fresh] ${early}`);
    // The vocabulary is printed by the script that holds the deletes, not only by the shared
    // gate: `guard:destructive-gate` reads this file, and an operator staring at a refusal in
    // a CI log needs the flag that clears it, in the language this script actually accepts.
    console.error('[seed-fresh] usage: npm run db:seed:from-empty -- --dry-run | --yes (also -y, --confirm); NUCRM_ALLOW_PROD_SEED=1 for a non-interactive run');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const db = drizzle(client, { schema });

  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.is_super_admin', 'true', true),
              set_config('app.current_tenant', '', true),
              set_config('app.current_user', '', true)`,
    );

    // Phase 2 — the count that can be trusted. seed-fresh generates its own ids, so the probe
    // keys on the fixture identities `db:state` reports, which is the same probe — so a database
    // this script already provisioned reads SEEDED on a re-run rather than POPULATED.
    const verdict = classify(readStateCounts((await client.query(STATE_SQL)).rows));
    console.log(`[seed-fresh] ${formatVerdict(verdict)}`);

    const blocked = refusal({
      script: 'seed-fresh',
      effect,
      target,
      state: verdict.state,
      production,
      yes,
      interactive,
      wipe: false,
    });
    if (blocked) throw new Error(blocked);

    if (flags.dryRun) {
      console.log('[seed-fresh] --dry-run: the decision was made inside this transaction and nothing has been written. ROLLBACK.');
      await client.query('ROLLBACK');
      return;
    }

    if (!yes) {
      const typed = await ask(`Type the database name "${target!.database}" to continue: `);
      if (!confirmationMatches(target!.database, typed)) {
        throw new Error(`REFUSING TO RUN: "${target!.database}" was not typed, so this run is not confirmed.`);
      }
    }

    // From here the deletions are the point of the script — the gate above is what makes running
    // it a deliberate act rather than a surprise.
    if (verdict.counts.users > 0) {
      console.log(`[seed-fresh] ${verdict.counts.users} user(s) exist. Cleaning the identity layer...`);
      await db.delete(sessions);
      await db.delete(tenantMembers);
      await db.delete(dealStages);
      await db.delete(pipelines);
      await db.delete(roles);
      await db.delete(users);
      await db.delete(tenants);
    }

    const passwordHash = await hashPassword(seedPassword);
    const [admin] = await db.insert(users).values({
      email: 'admin@nucrm.com',
      passwordHash,
      fullName: 'Super Admin',
      isSuperAdmin: true,
    }).returning();
    console.log(`[seed-fresh] Created admin: ${admin.id}`);

    const [tenant] = await db.insert(tenants).values({
      name: 'NuCRM Demo',
      slug: 'nucrm-demo-' + Date.now().toString(36),
      ownerId: admin.id,
      planId: 'enterprise',
      status: 'active',
    }).returning();
    console.log(`[seed-fresh] Created tenant: ${tenant.id}`);

    const [adminRole] = await db.insert(roles).values({
      tenantId: tenant.id,
      slug: 'admin',
      name: 'Administrator',
      permissions: { all: true },
      isSystem: true,
    }).returning();

    await db.insert(roles).values({
      tenantId: tenant.id,
      slug: 'sales_rep',
      name: 'Sales Representative',
      permissions: {
        'contacts.view': true, 'contacts.create': true, 'contacts.edit': true,
        'deals.view': true, 'deals.create': true, 'deals.edit': true,
      },
    });

    await db.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId: admin.id,
      roleSlug: 'admin',
      roleId: adminRole.id,
      status: 'active',
      joinedAt: new Date(),
    });

    await db.update(users).set({ lastTenantId: tenant.id }).where(eq(users.id, admin.id));

    const [pipeline] = await db.insert(pipelines).values({
      tenantId: tenant.id,
      name: 'Sales Pipeline',
      isDefault: true,
    }).returning();

    const stageRows = [
      { name: 'Lead', order: 1 },
      { name: 'Qualified', order: 2 },
      { name: 'Proposal', order: 3 },
      { name: 'Negotiation', order: 4 },
      { name: 'Closed Won', order: 5 },
      { name: 'Closed Lost', order: 6 },
    ];
    for (const s of stageRows) {
      await db.insert(dealStages).values({ tenantId: tenant.id, pipelineId: pipeline.id, name: s.name, order: s.order });
    }
    console.log(`[seed-fresh] Created pipeline with ${stageRows.length} stages`);

    const token = await createToken(admin.id);
    const tokenHash = await hashToken(token);
    await db.insert(sessions).values({
      userId: admin.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await client.query('COMMIT');
    console.log('[seed-fresh] Done!');
    console.log(`  Email:   admin@nucrm.com`);
    console.log(`  Tenant:  ${tenant.name} (${tenant.id})`);
    console.log(`  Password: \$${SEED_PASSWORD_ENV} (never printed — rotate it when this database stops being a fixture)`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}

main().catch((err) => {
  console.error('[seed-fresh] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
