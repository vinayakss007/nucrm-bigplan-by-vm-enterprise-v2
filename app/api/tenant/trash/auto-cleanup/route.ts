import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, tasks, leads, platformSettings } from '@/drizzle/schema';
import { eq, and, isNotNull, lt, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

const TRASH_RETENTION_KEY = 'trash_retention_days';
const DEFAULT_RETENTION_DAYS = 30;
/**
 * A retention of 0 would purge the trash the instant anything landed in it,
 * destroying the recovery window this feature exists to provide. One day is the
 * smallest value that still lets a user undo a mistaken delete.
 */
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650; // 10y — beyond this the cutoff is meaningless

export interface RetentionResolution {
  days: number;
  /** Set when the stored setting was unusable and the default was substituted. */
  invalidValue?: string;
}

/**
 * Resolves the configured retention window, refusing to trust the stored value.
 *
 * This guards a PERMANENT, irreversible delete, and the raw value comes from a
 * jsonb settings column, so it can be a non-numeric string, an object, null, or a
 * number that makes no sense. `parseInt(String(value))` accepted all of them:
 *
 *   "0"    -> cutoff = now        -> purges the entire trash immediately
 *   "-30"  -> cutoff = +30 days   -> purges EVERY soft-deleted row, any age
 *   "abc"  -> NaN                 -> Invalid Date cutoff
 *   {...}  -> NaN                 -> Invalid Date cutoff
 *
 * Anything outside [MIN, MAX] falls back to the default rather than being clamped
 * silently, and the caller is told, because a misconfigured retention is an
 * operator error worth surfacing — not something to paper over.
 */
export function resolveRetentionDays(rawValue: unknown): RetentionResolution {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return { days: DEFAULT_RETENTION_DAYS };
  }

  // Accept a number or a numeric string; reject objects/arrays outright.
  const candidate =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string'
        ? Number(rawValue.trim())
        : NaN;

  if (!Number.isFinite(candidate) || !Number.isInteger(candidate)) {
    return { days: DEFAULT_RETENTION_DAYS, invalidValue: String(rawValue) };
  }
  if (candidate < MIN_RETENTION_DAYS || candidate > MAX_RETENTION_DAYS) {
    return { days: DEFAULT_RETENTION_DAYS, invalidValue: String(rawValue) };
  }
  return { days: candidate };
}

async function getRetentionDays(tenantId: string): Promise<RetentionResolution> {
  const [setting] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(and(
      eq(platformSettings.tenantId, tenantId),
      eq(platformSettings.key, TRASH_RETENTION_KEY)
    ))
    .limit(1);
  return resolveRetentionDays(setting?.value ?? null);
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const retention = await getRetentionDays(ctx.tenantId);
    const retentionDays = retention.days;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Last line of defence before an irreversible delete: the cutoff must be a
    // real date in the past. resolveRetentionDays already guarantees this, so a
    // failure here means the invariant was broken upstream — refuse rather than
    // destroy data.
    if (Number.isNaN(cutoffDate.getTime()) || cutoffDate >= new Date()) {
      return NextResponse.json(
        { error: 'Refusing to purge: computed retention cutoff is not in the past.' },
        { status: 500 }
      );
    }

    const [contactResult, companyResult, dealResult, taskResult, leadResult] = await db.transaction(async (tx) => {
      return await Promise.all([
        tx.delete(contacts).where(and(
          eq(contacts.tenantId, ctx.tenantId),
          isNotNull(contacts.deletedAt),
          lt(contacts.deletedAt, cutoffDate)
        )),
        tx.delete(companies).where(and(
          eq(companies.tenantId, ctx.tenantId),
          isNotNull(companies.deletedAt),
          lt(companies.deletedAt, cutoffDate)
        )),
        tx.delete(deals).where(and(
          eq(deals.tenantId, ctx.tenantId),
          isNotNull(deals.deletedAt),
          lt(deals.deletedAt, cutoffDate)
        )),
        tx.delete(tasks).where(and(
          eq(tasks.tenantId, ctx.tenantId),
          isNotNull(tasks.deletedAt),
          lt(tasks.deletedAt, cutoffDate)
        )),
        tx.delete(leads).where(and(
          eq(leads.tenantId, ctx.tenantId),
          isNotNull(leads.deletedAt),
          lt(leads.deletedAt, cutoffDate)
        ))
      ]);
    });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countQuery = (table: any, tenantId: string) => 
      db.select({ count: sql<number>`count(*)` })
        .from(table)
        .where(and(eq(table.tenantId, tenantId), isNotNull(table.deletedAt)));

    const [contactCount, companyCount, dealCount, taskCount, leadCount] = await Promise.all([
      countQuery(contacts, ctx.tenantId),
      countQuery(companies, ctx.tenantId),
      countQuery(deals, ctx.tenantId),
      countQuery(tasks, ctx.tenantId),
      countQuery(leads, ctx.tenantId)
    ]);

    const cleanedUp = {
      contacts: contactResult.rowCount || 0,
      companies: companyResult.rowCount || 0,
      deals: dealResult.rowCount || 0,
      tasks: taskResult.rowCount || 0,
      leads: leadResult.rowCount || 0,
    };
    const totalPurged = Object.values(cleanedUp).reduce((a, b) => a + b, 0);

    // This is the only record that will exist of a permanent deletion — the rows
    // themselves are gone. Always logged, even at zero, so the schedule is
    // auditable; a misconfigured retention is recorded too.
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'trash_purge',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      newData: {
        purged: cleanedUp,
        total: totalPurged,
        retention_days: retentionDays,
        cutoff_date: cutoffDate.toISOString(),
        ...(retention.invalidValue !== undefined
          ? { invalid_retention_setting: retention.invalidValue }
          : {}),
      },
    });

    return NextResponse.json({
      cleaned_up: cleanedUp,
      remaining_in_trash: {
        contacts: contactCount[0]?.count || 0,
        companies: companyCount[0]?.count || 0,
        deals: dealCount[0]?.count || 0,
        tasks: taskCount[0]?.count || 0,
        leads: leadCount[0]?.count || 0
      },
      retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString(),
      // Surfaced rather than silently corrected, so the operator can fix it.
      ...(retention.invalidValue !== undefined
        ? {
            warning: `Configured ${TRASH_RETENTION_KEY} ("${retention.invalidValue}") is invalid; used the ${DEFAULT_RETENTION_DAYS}-day default.`,
          }
        : {}),
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[trash-auto-cleanup]', err);
    return apiError(err);
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const retention = await getRetentionDays(ctx.tenantId);
    const retentionDays = retention.days;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const [contactCount, companyCount, dealCount, taskCount, leadCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), isNotNull(contacts.deletedAt), lt(contacts.deletedAt, cutoffDate))),
      db.select({ count: sql<number>`count(*)` })
        .from(companies)
        .where(and(eq(companies.tenantId, ctx.tenantId), isNotNull(companies.deletedAt), lt(companies.deletedAt, cutoffDate))),
      db.select({ count: sql<number>`count(*)` })
        .from(deals)
        .where(and(eq(deals.tenantId, ctx.tenantId), isNotNull(deals.deletedAt), lt(deals.deletedAt, cutoffDate))),
      db.select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(and(eq(tasks.tenantId, ctx.tenantId), isNotNull(tasks.deletedAt), lt(tasks.deletedAt, cutoffDate))),
      db.select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(and(eq(leads.tenantId, ctx.tenantId), isNotNull(leads.deletedAt), lt(leads.deletedAt, cutoffDate)))
    ]);

    const pendingDeletion = 
      (contactCount[0]?.count || 0) +
      (companyCount[0]?.count || 0) +
      (dealCount[0]?.count || 0) +
      (taskCount[0]?.count || 0) +
      (leadCount[0]?.count || 0);

    return NextResponse.json({
      pending_deletion: {
        contacts: contactCount[0]?.count || 0,
        companies: companyCount[0]?.count || 0,
        deals: dealCount[0]?.count || 0,
        tasks: taskCount[0]?.count || 0,
        leads: leadCount[0]?.count || 0,
        total: pendingDeletion
      },
      retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString(),
      ...(retention.invalidValue !== undefined
        ? {
            warning: `Configured ${TRASH_RETENTION_KEY} ("${retention.invalidValue}") is invalid; using the ${DEFAULT_RETENTION_DAYS}-day default.`,
          }
        : {}),
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[trash-cleanup-status]', err);
    return apiError(err);
  }
}