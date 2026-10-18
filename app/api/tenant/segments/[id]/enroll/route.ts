/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Segment → Sequence sync (#1633).
 *   POST /api/tenant/segments/[id]/enroll  { sequence_id }
 *
 * Enrolls the segment's CONTACT members into the given sequence, honoring
 * opt-out (do_not_contact / unsubscribed) and skipping contacts already in an
 * active enrollment for that sequence. Only supported for contact segments
 * (sequences enroll contacts).
 *
 * Enrollment is a direct INSERT into `sequence_enrollments` rather than the
 * `enroll_contact_in_sequence` SQL function, whose deployed arity is ambiguous
 * (2-arg definition in migration 0032 vs 4-arg call sites) — a direct insert is
 * unambiguous and lets us set enrolledBy + dedupe safely.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { segments, segmentMembers, sequences, sequenceEnrollments, contacts } from '@/drizzle/schema';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { ownerScope } from '@/lib/api/owner-scope';
import { firstStepDueAt } from '@/lib/cron/sequence-steps';
import { isEntityId } from '@/lib/id';

export const POST = withApiRoute(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const limited = await rateLimitMutating(req, 'segments', 'post');
      if (limited) return limited;

      const ctx = await requireAuth(req);
      if (ctx instanceof NextResponse) return ctx;
      if (!can(ctx, 'automations.manage')) {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
      }
      const { id } = await params;
      // #2781 — the handler's own catch would turn this segment's uuid cast into a 500.
      if (!isEntityId(id)) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });

      const body = await readJsonBody(req);
      const sequenceId = typeof body.sequence_id === 'string' ? body.sequence_id : '';
      if (!sequenceId) {
        return NextResponse.json({ error: 'sequence_id is required' }, { status: 400 });
      }

      // Segment must exist, belong to the tenant, be live (#2291), and target contacts.
      const [seg] = await db
        .select()
        .from(segments)
        .where(and(eq(segments.id, id), eq(segments.tenantId, ctx.tenantId), isNull(segments.deletedAt)))
        .limit(1);
      if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
      if (seg.entityType !== 'contact') {
        return NextResponse.json(
          { error: 'Only contact segments can be enrolled into sequences' },
          { status: 422 },
        );
      }

      // Sequence must exist, belong to the tenant, and be active.
      const [seq] = await db
        .select({ id: sequences.id, status: sequences.status })
        .from(sequences)
        .where(and(eq(sequences.id, sequenceId), eq(sequences.tenantId, ctx.tenantId), isNull(sequences.deletedAt)))
        .limit(1);
      if (!seq) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
      if (seq.status !== 'active') {
        return NextResponse.json({ error: 'Sequence must be active to enroll contacts' }, { status: 400 });
      }

      // Cached member ids for the segment.
      const memberRows = await db
        .select({ entityId: segmentMembers.entityId })
        .from(segmentMembers)
        .where(and(eq(segmentMembers.segmentId, id), eq(segmentMembers.tenantId, ctx.tenantId)));
      const memberIds = memberRows.map((m) => m.entityId);
      const totalMembers = memberIds.length;

      if (memberIds.length === 0) {
        return NextResponse.json({
          ok: true,
          data: { enrolled: 0, skipped_opt_out: 0, skipped_not_owned: 0, skipped_existing: 0, total_members: 0 },
          message: 'Segment has no cached members. Refresh the segment first.',
        });
      }

      // #2732: every set below is assembled from rows the caller may never have been
      // allowed to read, so `automations.manage` alone let a `sales_rep`
      // (`lib/permissions/definitions.ts:133`, where `contacts.view_all` is explicitly
      // false) enroll a colleague's contact into a live mail sequence — a write to a
      // row that `contacts/[id]:82-87` answers 404 for. This is the owner rule
      // `ownerScope` exists for, the same one #2699 put on `notes/bulk` and #2728 on
      // `email/bulk`.
      //
      // The narrowing happens here, before the compliance filter below, rather than
      // inside it: those five terms decide whether a contact may be mailed at all, and
      // folding the owner rule in would make members this caller simply cannot reach
      // come back as `skipped_opt_out`. Dropping them first keeps each counter meaning
      // what its name says. For a `view_all` holder `ownerScope` renders nothing, this
      // round-trip is skipped entirely, and the route behaves exactly as it did.
      const ownedScope = ownerScope(ctx, 'contacts.view_all', contacts);
      let enrollableIds = memberIds;
      let skippedNotOwned = 0;
      if (ownedScope) {
        const visible = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(
            eq(contacts.tenantId, ctx.tenantId),
            inArray(contacts.id, memberIds),
            ownedScope,
          ));
        const visibleSet = new Set(visible.map((c) => c.id));
        skippedNotOwned = memberIds.length - visibleSet.size;
        enrollableIds = memberIds.filter((mid) => visibleSet.has(mid));
        if (enrollableIds.length === 0) {
          return NextResponse.json({
            ok: true,
            data: { enrolled: 0, skipped_opt_out: 0, skipped_not_owned: skippedNotOwned, skipped_existing: 0, total_members: totalMembers },
          });
        }
      }

      // Contactable members only: live, not opted out, not unsubscribed.
      const contactable = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(
          eq(contacts.tenantId, ctx.tenantId),
          inArray(contacts.id, enrollableIds),
          isNull(contacts.deletedAt),
          eq(contacts.doNotContact, false),
          eq(contacts.unsubscribed, false),
        ));
      const contactableIds = contactable.map((c) => c.id);
      const skippedOptOut = enrollableIds.length - contactableIds.length;

      if (contactableIds.length === 0) {
        return NextResponse.json({
          ok: true,
          data: { enrolled: 0, skipped_opt_out: skippedOptOut, skipped_not_owned: skippedNotOwned, skipped_existing: 0, total_members: totalMembers },
        });
      }

      // Contacts already in an ACTIVE enrollment for this sequence — don't re-add.
      const existing = await db
        .select({ contactId: sequenceEnrollments.contactId })
        .from(sequenceEnrollments)
        .where(and(
          eq(sequenceEnrollments.tenantId, ctx.tenantId),
          eq(sequenceEnrollments.sequenceId, sequenceId),
          eq(sequenceEnrollments.status, 'active'),
          inArray(sequenceEnrollments.contactId, contactableIds),
        ));
      const existingSet = new Set(existing.map((e) => e.contactId));
      const toEnroll = contactableIds.filter((cid) => !existingSet.has(cid));

      let enrolled = 0;

      if (toEnroll.length) {
        // #2793: without a due date the sweep can never select the row, so the
        // enrollment is active and silent forever.
        const nextStepAt = await firstStepDueAt(db, ctx.tenantId, sequenceId);
        // #2740: the pre-read above is the dedupe for the normal case; migration 0130's partial
        // unique index is what makes a racing second request a skipped row instead of a 23505
        // that aborts the batch. `rowCount` is then the honest count of what was enrolled.
        const inserted = await db.insert(sequenceEnrollments).values(
          toEnroll.map((contactId) => ({
            tenantId: ctx.tenantId,
            sequenceId,
            contactId,
            status: 'active' as const,
            currentStep: 1,
            nextStepAt,
            enrolledBy: ctx.userId,
            metadata: { source: 'segment', segment_id: id },
          })),
        ).onConflictDoNothing();
        enrolled = inserted.rowCount ?? toEnroll.length;
      }

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'enroll',
        entityType: 'segment',
        entityId: id,
        newData: { sequence_id: sequenceId, enrolled },
      });

      return NextResponse.json({
        ok: true,
        data: {
          enrolled,
          skipped_opt_out: skippedOptOut,
          skipped_not_owned: skippedNotOwned,
          skipped_existing: existingSet.size,
          total_members: totalMembers,
        },
      });
    } catch (err) {
      await logError({ error: err, context: 'segments/[id]/enroll POST', requestMethod: 'POST' });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
);
