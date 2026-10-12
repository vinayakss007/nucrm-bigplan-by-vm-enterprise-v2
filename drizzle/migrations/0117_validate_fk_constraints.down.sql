/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2260 down: intentionally a no-op. Postgres has no "un-validate" DDL —
-- reverting VALIDATE CONSTRAINT would mean DROP + ADD ... NOT VALID, which
-- reopens the orphan hole AND drops referential integrity for the window
-- between the two statements. A validated constraint is strictly safer than
-- an unvalidated one, so there is nothing to roll back TO. Reversal, if it
-- were ever truly needed, is a manual schema operation, not this file.
