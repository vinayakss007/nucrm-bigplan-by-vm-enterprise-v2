import { withSecurityContext, setTenantContext } from '@/lib/db/rls';
import { users, tenants, roles, tenantMembers } from '@/drizzle/schema';
import { hashPassword } from '@/lib/auth/session';
import { eq } from 'drizzle-orm';

async function main() {
  const email = 'debug@admin.test';
  const password = 'DebugPass123456!';
  const workspace_name = 'Debug Workspace';
  
  const passwordHash = await hashPassword(password);
  const emailLower = email.trim().toLowerCase();
  const fullNameTrim = 'Debug Admin';
  
  const result = await withSecurityContext(async (tx) => {
    console.log('1. Creating user...');
    const [u] = await tx.insert(users).values({
      email: emailLower,
      passwordHash,
      fullName: fullNameTrim,
      isSuperAdmin: true
    }).returning();
    console.log('   User created:', u.id);
    
    const slug = workspace_name.toLowerCase()
      .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
      + '-' + Date.now().toString(36);
    
    console.log('2. Creating tenant...');
    const [t] = await tx.insert(tenants).values({
      name: workspace_name.trim(),
      slug,
      ownerId: u.id,
      planId: 'enterprise',
      status: 'active'
    }).returning();
    console.log('   Tenant created:', t.id);
    
    console.log('3. Setting tenant context...');
    await setTenantContext(t.id, u.id, tx);
    console.log('   Context set');
    
    console.log('4. Creating admin role...');
    const [adminRole] = await tx.insert(roles).values({
      tenantId: t.id,
      slug: 'admin',
      name: 'Administrator',
      permissions: { all: true },
      isSystem: true,
    }).onConflictDoUpdate({
      target: [roles.tenantId, roles.slug],
      set: { permissions: { all: true }, updatedAt: new Date() },
    }).returning();
    console.log('   Admin role:', adminRole?.id);
    
    if (!adminRole) throw new Error('Failed to create admin role');
    
    console.log('5. Creating tenant member...');
    await tx.insert(tenantMembers).values({
      tenantId: t.id,
      userId: u.id,
      roleSlug: 'admin',
      roleId: adminRole.id,
      status: 'active',
      joinedAt: new Date(),
    }).onConflictDoUpdate({
      target: [tenantMembers.tenantId, tenantMembers.userId],
      set: { status: 'active', roleSlug: 'admin', roleId: adminRole.id, updatedAt: new Date() },
    });
    console.log('   Member created');
    
    console.log('6. Updating user lastTenantId...');
    await tx.update(users)
      .set({ lastTenantId: t.id })
      .where(eq(users.id, u.id));
    console.log('   User updated');
    
    return { u, t };
  });
  
  console.log('SUCCESS:', result.u.id, result.t.id);
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
