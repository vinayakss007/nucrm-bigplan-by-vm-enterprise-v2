/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0130 down: drop the partial unique index (#2740).
--
-- The rows the dedupe cancelled are intentionally NOT resurrected. They were duplicate live
-- enrollments for the same (sequence, contact) — the state that made the due sweep send every
-- step twice — and setting them back to 'active' would restore exactly the behaviour #2740 filed,
-- while the app has no path that re-activates a cancelled enrollment to put them through instead.
-- Dropping only the index returns the table to the shape every writer was already (mis)assuming.
DROP INDEX IF EXISTS "sequence_enrollments_seq_contact_active_unique";
