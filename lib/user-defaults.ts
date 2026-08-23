/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { users, tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

const VALID_VIEWS = ['list', 'kanban', 'card', 'calendar'] as const;

export async function getUserDefaultView(tenantId: string, userId: string): Promise<string> {
  try {
    const [u, t] = await Promise.all([
      db
        .select({ metadata: users.metadata })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
    ]);

    const userPrefs = ((u?.[0]?.metadata as Record<string, unknown>)?.prefs ?? {}) as Record<string, unknown>;
    if (userPrefs.default_record_view && VALID_VIEWS.includes(userPrefs.default_record_view as typeof VALID_VIEWS[number])) {
      return userPrefs.default_record_view as string;
    }

    const workspaceDefaults = (((t?.[0]?.settings as Record<string, unknown>) ?? {}).user_defaults ?? {}) as Record<string, unknown>;
    if (workspaceDefaults.default_record_view && VALID_VIEWS.includes(workspaceDefaults.default_record_view as typeof VALID_VIEWS[number])) {
      return workspaceDefaults.default_record_view as string;
    }

    return 'list';
  } catch (err) {
    // Falling back to 'list' is correct behaviour for a preference lookup, but a
    // failure here means the database is unreachable or the query is broken.
    // Swallowing it silently made a DB outage look like "user has no preference".
    logger.error('[user-defaults] Failed to read default view, falling back to list', {
      tenantId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'list';
  }
}
