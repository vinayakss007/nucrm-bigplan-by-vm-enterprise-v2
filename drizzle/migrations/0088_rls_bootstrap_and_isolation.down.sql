-- 0088 rollback.
--
-- Drops the bootstrap policies added by 0088 and restores the pre-0088 policy
-- definitions verbatim. The restored `tenant_id IS NULL OR ...` forms are the
-- ones this database actually had before 0088 — restoring them is a rollback,
-- not an endorsement; see the WHY block in the UP file for why they were
-- replaced. RLS is left ENABLED on the five tables 0088 switched on, because
-- disabling protection is never a safe automatic step.

DROP POLICY IF EXISTS "users_bootstrap_insert" ON "users";
DROP POLICY IF EXISTS "tenants_bootstrap_insert" ON "tenants";

DROP POLICY IF EXISTS "tenant_isolation" ON "platform_settings";
CREATE POLICY "tenant_isolation" ON "platform_settings" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

DROP POLICY IF EXISTS "tenant_isolation" ON "oauth_clients";
CREATE POLICY "tenant_isolation" ON "oauth_clients" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

DROP POLICY IF EXISTS "tenant_isolation" ON "backup_schedules";
CREATE POLICY "tenant_isolation" ON "backup_schedules" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

DROP POLICY IF EXISTS "tenant_isolation" ON "lead_warming_events";
CREATE POLICY "tenant_isolation" ON "lead_warming_events" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

DROP POLICY IF EXISTS "tenant_isolation" ON "error_logs";
DROP POLICY IF EXISTS "error_logs_insert_any" ON "error_logs";
DROP POLICY IF EXISTS "error_logs_super_admin_write" ON "error_logs";
DROP POLICY IF EXISTS "error_logs_super_admin_delete" ON "error_logs";
CREATE POLICY "tenant_isolation" ON "error_logs" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

DROP POLICY IF EXISTS "tenant_isolation" ON "security_events";
DROP POLICY IF EXISTS "security_events_insert_any" ON "security_events";
DROP POLICY IF EXISTS "security_events_super_admin_write" ON "security_events";
DROP POLICY IF EXISTS "security_events_super_admin_delete" ON "security_events";
CREATE POLICY "tenant_isolation" ON "security_events" FOR ALL USING (
  (tenant_id IS NULL) OR (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
);

DROP POLICY IF EXISTS "tenant_isolation" ON "usage_alerts";
CREATE POLICY "usage_alerts_read_all" ON "usage_alerts" FOR SELECT USING (true);

DROP POLICY IF EXISTS "tenant_isolation" ON "hierarchy_permissions";
CREATE POLICY "hierarchy_permissions_read_all" ON "hierarchy_permissions" FOR SELECT USING (true);

DROP POLICY IF EXISTS "tenant_isolation" ON "custom_entities";
CREATE POLICY "custom_entities_tenant_isolation" ON "custom_entities" FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  tenant_id = current_setting('app.current_tenant', true)::uuid
);

DROP POLICY IF EXISTS "tenant_isolation" ON "custom_entity_data";
CREATE POLICY "custom_entity_data_tenant_isolation" ON "custom_entity_data" FOR ALL USING (
  current_setting('app.current_tenant', true) != '' AND
  tenant_id = current_setting('app.current_tenant', true)::uuid
);

DROP POLICY IF EXISTS "tenant_isolation" ON "contact_emails";
CREATE POLICY "contact_emails_tenant_isolation" ON "contact_emails" FOR ALL USING (
  (current_setting('app.current_tenant', true) <> '') AND EXISTS (
    SELECT 1 FROM "contacts" c
    WHERE c.id = contact_emails.contact_id
      AND c.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

DROP POLICY IF EXISTS "tenant_isolation" ON "price_book_entries";
CREATE POLICY "price_book_entries_tenant_isolation" ON "price_book_entries" FOR ALL USING (
  (current_setting('app.current_tenant', true) <> '') AND EXISTS (
    SELECT 1 FROM "price_books" pb
    WHERE pb.id = price_book_entries.price_book_id
      AND pb.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);

DROP POLICY IF EXISTS "tenant_isolation" ON "webhook_queue";
CREATE POLICY "webhook_queue_tenant_isolation" ON "webhook_queue" FOR ALL USING (
  (current_setting('app.current_tenant', true) <> '') AND EXISTS (
    SELECT 1 FROM "webhooks" w
    WHERE w.id = webhook_queue.webhook_id
      AND w.tenant_id = current_setting('app.current_tenant', true)::uuid
  )
);
