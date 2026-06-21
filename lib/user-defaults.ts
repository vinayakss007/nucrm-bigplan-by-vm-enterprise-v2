import { db } from '@/drizzle/db';
import { users, tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

const VALID_VIEWS = ['list', 'kanban', 'card', 'calendar'] as const;

export async function getUserDefaultView(tenantId: string, userId: string): Promise<string> {
  try {
    const [u] = await db
      .select({ metadata: users.metadata })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const userPrefs = ((u?.metadata as Record<string, unknown>)?.prefs ?? {}) as Record<string, unknown>;
    if (userPrefs.default_record_view && VALID_VIEWS.includes(userPrefs.default_record_view as typeof VALID_VIEWS[number])) {
      return userPrefs.default_record_view as string;
    }

    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const workspaceDefaults = (((t?.settings as Record<string, unknown>) ?? {}).user_defaults ?? {}) as Record<string, unknown>;
    if (workspaceDefaults.default_record_view && VALID_VIEWS.includes(workspaceDefaults.default_record_view as typeof VALID_VIEWS[number])) {
      return workspaceDefaults.default_record_view as string;
    }

    return 'list';
  } catch {
    return 'list';
  }
}
