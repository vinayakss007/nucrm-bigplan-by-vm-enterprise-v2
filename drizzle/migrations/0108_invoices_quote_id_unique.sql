-- 0108: one live invoice per quote (#2228, constraint requested by #2257).
--
-- POST /api/tenant/quotes/[id]/convert-to-invoice does its "already
-- converted?" SELECT OUTSIDE the db.transaction, then INSERTs the invoice
-- inside it. Two concurrent converts (double-click, retried request) both
-- pass the pre-check and both insert — the route's 23505-retry loop could
-- never fire as a guard because NOTHING on invoices was unique per quote:
-- the tenant FOR UPDATE lock only serializes invoice-number generation, not
-- quote provenance. Real duplicate invoices for one quote are exactly the
-- double-billing the audit found.
--
-- The fix is a partial UNIQUE index on quote_id over live rows only:
--   * partial `WHERE deleted_at IS NULL` — soft-deleting a converted invoice
--     must free the quote for a legitimate reconversion (the route's
--     pre-check also filters isNull(deletedAt), so app and DB agree);
--   * quote_id IS NULL (invoices not born from a quote) never collides —
--     Postgres UNIQUE counts NULLs as distinct.
-- With the index in place the loser of the race gets a clean 23505 on
-- constraint uq_invoices_quote_id, which the route now catches and answers
-- 409 + the winner's invoice id (no 500, no second invoice).
--
-- Existing duplicates would abort the index build with an obscure 23505, so
-- the DO block pre-scans and RAISEs EXCEPTION with the offending quote ids —
-- fail loudly, never auto-delete money records.
DO $$
DECLARE
  dup_list text;
BEGIN
  SELECT string_agg(quote_id::text, ', ' ORDER BY quote_id)
    INTO dup_list
    FROM (
      SELECT quote_id
        FROM invoices
       WHERE quote_id IS NOT NULL
         AND deleted_at IS NULL
       GROUP BY quote_id
      HAVING count(*) > 1
    ) d;

  IF dup_list IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to create uq_invoices_quote_id: quote(s) % have multiple live invoices (#2228). Soft-delete the duplicate invoice rows, then re-run the migration.', dup_list;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoices_quote_id" ON "invoices" ("quote_id") WHERE deleted_at IS NULL;
