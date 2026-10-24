/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Bulk Contact Operations
 * POST /api/tenant/contacts/bulk
 * Body: { action, contact_ids?, payload?, selectAll?, filters? }
 * Actions: tag, untag, assign, status, delete, export
 * When selectAll=true, contact_ids is optional; contacts are resolved from filters.
 */
import { apiError } from '@/lib/api-error';
import { escapeLike } from '@/lib/api/sanitize-like';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { bulkUpdateSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, type AuthContext } from '@/lib/auth/middleware';
import { ownerScope } from '@/lib/api/owner-scope';
import { db } from '@/drizzle/db';
import { contacts, tenantMembers, sequences, sequenceEnrollments, segments, segmentMembers, companies, tenants } from '@/drizzle/schema';
import { eq, and, sql, inArray, isNull, or, ilike, type SQL } from 'drizzle-orm';
import { logAudit, bulkIdsAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';
import { invalidateWidgetCache } from '@/lib/dashboard/widget-cache';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { cancelOpenEnrollments, firstStepDueAt } from '@/lib/cron/sequence-steps';
import { restoreBulkContacts } from '@/lib/contacts/bulk-restore';
import { withApiRoute } from '@/lib/api/with-api-route';
import { enforceFieldWrite } from '@/lib/rbac/enforce';

const MAX_BULK = 500;

export const POST = withApiRoute(async (req: NextRequest) => {
  const limited = await rateLimitMutating(req, 'bulk', 'post');
  if (limited) return limited;
 
 
  let ctx!: AuthContext;
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    ctx = auth;

    const rawBody = await readJsonBody(req);
    const action = rawBody.action;
    const selectAll = rawBody.selectAll === true;
    const filters = rawBody.filters as { q?: string; lead_status?: string; company_id?: string } | undefined;

    // In selectAll mode, resolve IDs from filters; otherwise require explicit IDs
    let contact_ids: string[] = rawBody.contact_ids ?? [];

    // #2673 — this route had no `view_all` reference at all: both of its id sets
    // were scoped by tenant, archive flag and tombstone only, while
    // `contacts/[id]` answers 404 to a caller who lacks `contacts.view_all` unless
    // the contact is theirs (`:82-87` GET, `:195-200` PATCH, `:304-311` DELETE) and
    // the list narrows with `canViewAll` (`contacts/route.ts:28-30`). So "select all
    // matching" enumerated the whole workspace and an explicit `contact_ids` list was
    // accepted as-is. See lib/api/owner-scope.ts for the shared predicate.
    const ownedScope = ownerScope(ctx, 'contacts.view_all', contacts);

    if (selectAll) {
      // Build filter conditions from the same logic as the contacts list endpoint
      const whereConditions: SQL[] = [
        eq(contacts.tenantId, ctx.tenantId),
        eq(contacts.isArchived, false),
        isNull(contacts.deletedAt),
      ];
      // Before the caller's filters: `company_id`/`lead_status`/`assigned_to` may
      // narrow this further, and naming another owner cannot widen it back.
      if (ownedScope) whereConditions.push(ownedScope);

      if (filters?.lead_status) {
        whereConditions.push(eq(contacts.leadStatus, filters.lead_status));
      }
      if (filters?.company_id) {
        whereConditions.push(eq(contacts.companyId, filters.company_id));
      }
      if (filters?.q) {
        whereConditions.push(or(
          ilike(contacts.firstName, `%${escapeLike(filters.q)}%`),
          ilike(contacts.lastName, `%${escapeLike(filters.q)}%`),
          ilike(contacts.email, `%${escapeLike(filters.q)}%`),
          ilike(contacts.phone, `%${escapeLike(filters.q)}%`),
        )!);
      }

      const matched = await db
        .select({ id: contacts.id })
        .from(contacts)
        .leftJoin(companies, eq(companies.id, contacts.companyId))
        .where(and(...whereConditions));

      contact_ids = matched.map(r => r.id);

      if (!contact_ids.length) {
        return NextResponse.json({ error: 'No contacts match the provided filters' }, { status: 404 });
      }
      if (contact_ids.length > MAX_BULK) {
        return NextResponse.json({ error: `Max ${MAX_BULK} contacts per bulk operation (matched ${contact_ids.length})` }, { status: 400 });
      }
    } else {
      // Legacy mode: require explicit IDs
      const validated = validateBody(bulkUpdateSchema, rawBody);
      if (validated instanceof NextResponse) return validated;
      const v = validated.data;
      contact_ids = v.ids;

      if (!Array.isArray(contact_ids) || !contact_ids.length)
        return NextResponse.json({ error: 'contact_ids array required' }, { status: 400 });
      if (contact_ids.length > MAX_BULK)
        return NextResponse.json({ error: `Max ${MAX_BULK} contacts per bulk operation` }, { status: 400 });
    }

    // Validate all IDs belong to this tenant
    const valid = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, contact_ids),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.deletedAt} IS NULL`,
          // Both id sets must narrow, or `selectAll` plus a foreign id walks
          // through whichever one is unguarded.
          ownedScope
        )
      );
    
    const validIds = valid.map(r => r.id);
    // `restore` is the one action whose target set is NOT `validIds` — trashed and
    // archived rows are excluded from it by construction. Both siblings exempt it
    // here and re-resolve their own set (`leads/bulk:70`, `deals/bulk:92`); without
    // the exemption a restore 404s before the switch ever runs.
    if (!validIds.length && action !== 'restore')
      return NextResponse.json({ error: 'No valid contacts found' }, { status: 404 });

    const payload = rawBody.payload ?? {};
    let affected = 0;
    // The audit trail logs the ids the action actually touched, which for `restore`
    // is the re-resolved set rather than this live one.
    let auditIds: string[] = validIds;
    // Optional extra fields merged into the response (e.g. compliance skip counts).
    let extraResult: Record<string, unknown> = {};

    // #2618 — same doctrine as the deals bulk gate (#2641): assign/status
    // write contact columns straight from payload keys; stripping the action's
    // only value would leave the action meaningless, so reject (403) when
    // field_permissions restricts the field.
    const BULK_WATCHED_FIELDS: Record<string, string[]> = {
      assign: ['assigned_to'],
      status: ['lead_status'],
    };
    const watched = BULK_WATCHED_FIELDS[action as string];
    if (watched) {
      const { stripped } = await enforceFieldWrite(
        ctx, 'contacts', Object.fromEntries(watched.map((f) => [f, true])),
      );
      if (stripped.length > 0) {
        return NextResponse.json(
          { error: `field_permissions restricts: ${stripped.join(', ')}` },
          { status: 403 },
        );
      }
    }

    switch (action) {
      case 'tag': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const tag = (payload['tag'] as string | undefined)?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        
        const res = await db
          .update(contacts)
          .set({
            tags: sql`array_append(${contacts.tags}, ${tag})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId),
              sql`NOT (${tag} = ANY(${contacts.tags}))`
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'untag': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const tag = (payload['tag'] as string | undefined)?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        
        const res = await db
          .update(contacts)
          .set({
            tags: sql`array_remove(${contacts.tags}, ${tag})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'assign': {
        const deny = requirePerm(ctx, 'contacts.assign');
        if (deny) return deny;
        const assignTo = payload['assign_to'] as string | undefined;
        if (!assignTo) return NextResponse.json({ error: 'assign_to required' }, { status: 400 });
        
        // Verify assignee is a member
        const [member] = await db
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.userId, assignTo),
              eq(tenantMembers.tenantId, ctx.tenantId),
              eq(tenantMembers.status, 'active')
            )
          )
          .limit(1);
        
        if (!member) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
        
        const res = await db
          .update(contacts)
          .set({
            assignedTo: assignTo,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'status': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const leadStatus = payload['lead_status'] as string | undefined;
        const STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];
        if (!leadStatus || !STATUSES.includes(leadStatus))
          return NextResponse.json({ error: `lead_status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
        
        const res = await db
          .update(contacts)
          .set({
            leadStatus: leadStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'delete': {
        const deny = requirePerm(ctx, 'contacts.delete');
        if (deny) return deny;
        
        await db.transaction(async (tx) => {
          const res = await tx
            .update(contacts)
            .set({
              deletedAt: new Date(),
              deletedBy: ctx.userId,
              isArchived: true,
              updatedAt: new Date(),
            })
            .where(
              and(
                inArray(contacts.id, validIds),
                eq(contacts.tenantId, ctx.tenantId),
                sql`${contacts.deletedAt} IS NULL`
              )
            );
          
          affected = res.rowCount ?? 0;
          // Decrement the tenant's currentContacts counter by the number of affected contacts
          if (affected > 0) {
            await tx.update(tenants)
              .set({ currentContacts: sql`greatest(0, ${tenants.currentContacts} - ${affected})` })
              .where(eq(tenants.id, ctx.tenantId));

            // #2392: the single delete cancels in its tombstone transaction;
            // this is the same write with a list of subjects, and the drip used
            // to keep mailing all of them. Cancelling here rather than leaving
            // the rows 'active' for the cron also means a restore cannot
            // silently resume outbound email to people the tenant trashed.
            extraResult.cancelledEnrollments = await cancelOpenEnrollments(tx, ctx.tenantId, {
              contactIds: validIds,
            });
          }
        });
        break;
      }
      case 'do_not_contact': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const val = payload['value'] !== false;
        
        const res = await db
          .update(contacts)
          .set({
            doNotContact: val,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'update_field': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const fieldKey = payload['field_key'] as string | undefined;
        const fieldValue = payload['field_value'];
        if (!fieldKey) return NextResponse.json({ error: 'field_key required' }, { status: 400 });
        
        const res = await db
          .update(contacts)
          .set({
            customFields: sql`jsonb_set(COALESCE(${contacts.customFields}, '{}'::jsonb), ${'{"' + fieldKey + '"}'}::text[], ${JSON.stringify(fieldValue)}::jsonb, true)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'archive': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const res = await db
          .update(contacts)
          .set({
            isArchived: true,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId),
              sql`${contacts.deletedAt} IS NULL`
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'restore': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        // #3111 — the delete case above decrements tenants.currentContacts by the
        // rows it tombstoned; this had to be the inverse and was a bare UPDATE:
        // no re-increment, no plan check, no transaction. See lib/contacts/bulk-restore.
        const outcome = await restoreBulkContacts(db, {
          tenantId: ctx.tenantId,
          ids: contact_ids,
          scope: ownedScope,
        });
        if (!outcome.ok) {
          if (outcome.reason === 'over-plan-limit') {
            return NextResponse.json(
              { error: `Restore would exceed plan limit of ${outcome.maxContacts} contacts.` },
              { status: 403 },
            );
          }
          return NextResponse.json({ error: 'No deleted or archived contacts found to restore' }, { status: 404 });
        }
        affected = outcome.restored;
        auditIds = outcome.ids;
        break;
      }
      case 'add_to_sequence': {
        const deny = requirePerm(ctx, 'automations.manage');
        if (deny) return deny;
        const sequenceId = payload['sequence_id'] as string | undefined;
        if (!sequenceId) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 });
        
        const [seq] = await db.select({ id: sequences.id }).from(sequences)
          .where(and(eq(sequences.id, sequenceId), eq(sequences.tenantId, ctx.tenantId), isNull(sequences.deletedAt)))
          .limit(1);
        if (!seq) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });

        // #1120: never enroll contacts who have opted out. Resolve the eligible
        // subset (not unsubscribed, not do-not-contact, not deleted) before
        // building enrollment rows — CAN-SPAM/GDPR compliance.
        const eligibleRows = await db.select({ id: contacts.id }).from(contacts)
          .where(and(
            inArray(contacts.id, validIds),
            eq(contacts.tenantId, ctx.tenantId),
            isNull(contacts.deletedAt),
            eq(contacts.doNotContact, false),
            eq(contacts.unsubscribed, false),
          ));
        const eligibleIds = eligibleRows.map(r => r.id), skippedOptedOut = validIds.length - eligibleIds.length;
        auditIds = eligibleIds; // #3220 — an opted-out contact is named in no audit row

        if (eligibleIds.length === 0) {
          affected = 0;
          break;
        }

        await db.transaction(async (tx) => {
          // #2793: a row written without `next_step_at` is `active` but can never
          // be picked up by the cron's due sweep, so the drip silently never sent.
          const nextStepAt = await firstStepDueAt(tx, ctx.tenantId, sequenceId);
          const enrollValues = eligibleIds.map(contactId => ({
            tenantId: ctx.tenantId,
            sequenceId,
            contactId,
            enrolledBy: ctx.userId,
            status: 'active',
            currentStep: 1,
            nextStepAt,
          }));
          
          const res = await tx.insert(sequenceEnrollments).values(enrollValues).onConflictDoNothing();
          affected = res.rowCount ?? enrollValues.length;
          
          await tx.update(sequences).set({ enrollCount: sql`COALESCE(${sequences.enrollCount}, 0) + ${affected}` })
            .where(eq(sequences.id, sequenceId));
        });

        if (skippedOptedOut > 0) {
          extraResult = { skipped_opted_out: skippedOptedOut };
        }
        
        break;
      }
      case 'add_to_segment': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const segId = payload['segment_id'] as string | undefined;
        if (!segId) return NextResponse.json({ error: 'segment_id required' }, { status: 400 });
        const [seg] = await db.select({ id: segments.id }).from(segments)
          .where(and(eq(segments.id, segId), eq(segments.tenantId, ctx.tenantId), isNull(segments.deletedAt)))
          .limit(1);
        if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
        const memberValues = validIds.map(entityId => ({ segmentId: segId, entityId, tenantId: ctx.tenantId }));
        const inserted = await db
          .insert(segmentMembers)
          .values(memberValues)
          .onConflictDoNothing()
          .returning({ entityId: segmentMembers.entityId });
        affected = inserted.length;
        auditIds = inserted.map(r => r.entityId);
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    invalidateWidgetCache(ctx.tenantId, 'stats-contacts', 'contacts-recent', 'activity');

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, entityType: 'contact',
      newData: bulkIdsAudit({ idsKey: 'contact_ids', ids: auditIds, affected, payload }),
    });

    return NextResponse.json({ ok: true, affected, action, ...extraResult });
 
 
  } catch (err) {
    await logError({ error: err, context: 'tenant/contacts bulk POST', requestMethod: 'POST' });
    await logError({ error: err, context: 'contacts/bulk', tenantId: ctx?.tenantId });
    return apiError(err);
  }
});

