-- Migration ID: 0040_lead_product_service_request
-- Name: A lead can name the product or service it is a request for
-- Dependencies: 0038_cross_module_record_linking
--
-- RENUMBER NOTE: migration numbering has been fixed; this is now at its correct position.

-- WHY THIS EXISTS
-- ---------------
-- A lead is a small inbound request that can arrive from anywhere — a form, a
-- phone number, an email, a chat. That request is almost always ABOUT
-- something: a product the person wants, or a service they are asking for.
--
-- The leads table already carries product_id, but that column means "which
-- product ENTRY POINT (lib/products/registry.ts) did this lead arrive through"
-- — a channel, not the catalogue item requested. There was no way to say
-- "this lead is a request for Product X" or "...for Service Y" against the
-- tenant's real products/services catalogue, so a lead could not be grouped or
-- reported on by what was actually being asked for.
--
-- These two nullable FK columns close that gap. Both SET NULL on delete: losing
-- a catalogue item must never delete the lead that referenced it.

-- UP Migration
BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS requested_product_id uuid;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS requested_service_id uuid;

COMMIT;


BEGIN;

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('leads', 'requested_product_id', 'products', 'SET NULL'),
      ('leads', 'requested_service_id', 'services', 'SET NULL')
    ) AS t(child, col, parent, on_delete)
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I)
           REFERENCES %I(id) ON DELETE %s NOT VALID',
        fk.child, fk.child || '_' || fk.col || '_fkey', fk.col, fk.parent, fk.on_delete
      );
      RAISE NOTICE 'added %.% -> %(id) ON DELETE %', fk.child, fk.col, fk.parent, fk.on_delete;
    EXCEPTION
      WHEN duplicate_object THEN
        RAISE NOTICE '%.% foreign key already present', fk.child, fk.col;
      WHEN others THEN
        RAISE WARNING 'could not add %.% -> % (%)', fk.child, fk.col, fk.parent, SQLERRM;
    END;
  END LOOP;
END $$;

-- These columns exist to be filtered on ("all leads requesting this service"),
-- so an unindexed FK would turn each such panel into a sequential scan. Partial
-- indexes because the vast majority of legacy leads have neither set.
CREATE INDEX IF NOT EXISTS idx_leads_requested_product
  ON leads(tenant_id, requested_product_id) WHERE requested_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_requested_service
  ON leads(tenant_id, requested_service_id) WHERE requested_service_id IS NOT NULL;

COMMIT;
