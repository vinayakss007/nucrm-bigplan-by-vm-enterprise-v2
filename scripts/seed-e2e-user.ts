#!/usr/bin/env tsx
import { db } from '../drizzle/db';
import { users, tenants, tenantMembers, roles, sessions } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { hashPassword, createToken, hashToken } from '../lib/auth/session';
import * as crypto from 'crypto';

async function main() {
  const email = 'superadmin@nucrm.com';

  const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser.length > 0) {
    console.log('E2E user already exists. Skipping.');
    return;
  }

  const userId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const passwordHash = await hashPassword('admin123');

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    fullName: 'Test Admin',
    isSuperAdmin: false,
    lastTenantId: tenantId,
  });

  await db.insert(tenants).values({
    id: tenantId,
    name: 'E2E Test Workspace',
    slug: 'e2e-test-' + Date.now().toString(36),
    ownerId: userId,
    status: 'active',
  });
  // DB trigger on_tenant_created auto-creates default roles

  const [role] = await db.select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, 'admin')))
    .limit(1);

  if (!role) {
    console.error('Admin role not auto-created by trigger. Check DB functions.');
    process.exit(1);
  }

  await db.insert(tenantMembers).values({
    tenantId,
    userId,
    roleId: role.id,
    roleSlug: 'admin',
    status: 'active',
    joinedAt: new Date(),
  });

  const token = await createToken(userId);
  const tokenHash = await hashToken(token);
  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  console.log('E2E test user created!');
  console.log('  Email:    ' + email);
  console.log('  Password: admin123');
}

main().catch(console.error);
