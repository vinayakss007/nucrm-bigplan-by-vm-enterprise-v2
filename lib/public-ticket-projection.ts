/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { supportTickets } from '@/drizzle/schema';

/**
 * Every `support_tickets` column a customer may be sent (#2443).
 *
 * Both public ticket handlers — the list and the detail, the `x-portal-token`
 * branch and the cookie branch — select this one map, so the two halves of the
 * portal read one shape out of one table.
 *
 * It exists because `db.select()` with no argument list is `SELECT *`. The
 * detail route did that and then removed `portal_token` from the result, which
 * meant the response was "the internal record minus one column": the operator's
 * `metadata.resolution` prose (`app/api/superadmin/tickets/route.ts` writes it),
 * the staff and pipeline uuids (`assigned_to`, `created_by`, `company_id`,
 * `deal_id`, `lead_id`) and the SLA internals all reached the customer's own
 * page, and the next column added to the table would join them with no diff to
 * review. Naming the columns moves that decision into this file, where it has
 * an author and a reviewer.
 *
 * `created_at` is snake_case on purpose: it is the alias the list handler has
 * always returned and the key
 * `app/portal/(protected)/tickets/[id]/page.tsx` renders. The detail route's
 * unprojected read returned camelCase `createdAt`, so `formatDate` fell back to
 * its em-dash sentinel and every portal ticket page showed "—" where the opened
 * date belongs — a consumer that could only be right by luck, because the wire
 * shape was an accident of the ORM call rather than a decision.
 *
 * Adding a field here is a disclosure decision. Adding a column to the table
 * must never be one.
 */
export const PUBLIC_TICKET_COLUMNS = {
  id: supportTickets.id,
  subject: supportTickets.subject,
  body: supportTickets.body,
  status: supportTickets.status,
  priority: supportTickets.priority,
  category: supportTickets.category,
  created_at: supportTickets.createdAt,
};

/**
 * The row `PUBLIC_TICKET_COLUMNS` produces, written out rather than inferred so
 * that the key set is reviewable in one glance. TypeScript checks it at every
 * `db.select(PUBLIC_TICKET_COLUMNS)` call site: if the map and this type drift,
 * `readPublicTicket` stops compiling.
 */
export type PublicTicketRow = {
  id: string;
  subject: string;
  body: string;
  status: string;
  priority: string;
  category: string | null;
  created_at: Date;
};

/**
 * Every `support_tickets` column a staff ticket write may echo (#2498).
 *
 * Both staff create routes called `.returning()` with no argument list, which is
 * `RETURNING *` — all **23** columns of `support_tickets` (measured against a
 * `db:sync` database), handed back as `{ data: row }`. The tenant route then
 * spread the same row into `evaluateAutomations()`, and the engine persists that
 * payload as `automation_runs.metadata` (`lib/automation/engine.ts:96`, `:109`)
 * and POSTs it to whichever URL a `fire_webhook` action is configured with
 * (`lib/automation/engine.ts:314`). So one create could put `portal_token` — still
 * a working bearer credential until #2444 deploys, measured against the running
 * container — in front of an API client, a second table and an external party,
 * none of which asked for it.
 *
 * The set below is the ticket's own business columns: what the caller just sent,
 * plus the server's identifiers, the pipeline links, the SLA linkage and the two
 * timestamps a list row is rendered from. What it drops is what a create response
 * has no business carrying — the credential, `metadata` (operator prose, per
 * #2443), and the who-did-what audit uuids with `deleted_at`/`deleted_by`.
 *
 * Neither caller reads the create response today — `app/tenant/tickets/page.tsx`
 * checks `res.ok`, toasts and refetches, and the super-admin page has no POST
 * caller at all — so this set is free to be the projection the staff UI will
 * eventually want, and the list handlers already state it: the same business
 * columns as `app/api/tenant/tickets/route.ts:63-76` and
 * `app/api/superadmin/tickets/route.ts:34-49`, less their join-only display
 * fields (`firstName`, `assignedName`, `tenantName`, `userEmail`) and plus the
 * pipeline and SLA links a detail view resolves. Nothing here is invented for
 * this one route.
 *
 * Keys stay camelCase because that is what `.returning()` already produced, so the
 * automation payload keeps exactly the shape its conditions see today. The engine
 * reads snake_case (`str(enrichedData, 'assigned_to')`), and `getNestedValue`
 * treats an absent key and a null one identically for `is_empty`/`is_not_empty`,
 * so removing a column from this map cannot flip a condition from false to true —
 * only from "value" to "empty", which is the point.
 *
 * Adding a field here is a disclosure decision. Adding a column to the table must
 * never be one.
 */
export const STAFF_TICKET_COLUMNS = {
  id: supportTickets.id,
  tenantId: supportTickets.tenantId,
  contactId: supportTickets.contactId,
  companyId: supportTickets.companyId,
  dealId: supportTickets.dealId,
  leadId: supportTickets.leadId,
  subject: supportTickets.subject,
  body: supportTickets.body,
  status: supportTickets.status,
  priority: supportTickets.priority,
  category: supportTickets.category,
  assignedTo: supportTickets.assignedTo,
  slaPolicyId: supportTickets.slaPolicyId,
  firstResponseAt: supportTickets.firstResponseAt,
  resolvedAt: supportTickets.resolvedAt,
  createdAt: supportTickets.createdAt,
  updatedAt: supportTickets.updatedAt,
};
