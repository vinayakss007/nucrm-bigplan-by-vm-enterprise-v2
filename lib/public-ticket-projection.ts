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
