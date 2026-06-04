#!/usr/bin/env tsx
import { db } from '../drizzle/db';
import { users, tenants, tenantMembers, roles, sessions } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { hashPassword, createToken, hashToken } from '../lib/auth/session';
import * as crypto from 'crypto';

async function main() {
  const email = 'superadmin@nucrm.com';
  const password = 'admin123';
  const fullName = 'Super Admin';
  const tenantName = 'E2E Test Workspace';

  console.log(`Seeding E2E test user: ${email}`);

  // Check if user already exists
  const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingUser.length > 0) {
    console.log('User already exists, updating password...');
    const passwordHash = await hashPassword(password);
    await db.update(users).set({ passwordHash }).where(eq(users.id, existingUser[0].id));
    console.log('Password updated. User ID:', existingUser[0].id);
    return;
  }

  const userId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  // Create user
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    fullName,
    isSuperAdmin: true,
    lastTenantId: tenantId,
  });

  // Create tenant
  await db.insert(tenants).values({
    id: tenantId,
    name: tenantName,
    slug: `e2e-test-${Date.now()}`,
    ownerId: userId,
    status: 'active',
  });

  // Create admin role
  const [role] = await db.insert(roles).values({
    id: crypto.randomUUID(),
    tenantId,
    slug: 'admin',
    name: 'Administrator',
    permissions: { all: true },
    isSystem: true,
  }).returning();

  // Create tenant membership
  await db.insert(tenantMembers).values({
    tenantId,
    userId,
    roleId: role.id,
    roleSlug: 'admin',
    status: 'active',
    joinedAt: new Date(),
  });

  // Create session
  const token = await createToken(userId);
  const tokenHash = await hashToken(token);
  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  console.log('E2E test user created successfully!');
  console.log('  User ID:', userId);
  console.log('  Tenant ID:', tenantId);
}

main().catch(console.error);
