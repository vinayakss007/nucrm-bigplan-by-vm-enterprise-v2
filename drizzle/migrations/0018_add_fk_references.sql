-- Migration: Add FK references on tenant_id and created_by utility columns
-- Generated: 2026-06-12T12:16:58.456524

-- ============================================================================
-- ADD FK: tenant_id -> tenants(id) ON DELETE CASCADE
-- ============================================================================

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ai_provider_secrets') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_secrets_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "ai_provider_secrets" ADD CONSTRAINT "ai_provider_secrets_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'assignment_logs') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_logs_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "assignment_logs" ADD CONSTRAINT "assignment_logs_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'assignment_rules') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_rules_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'chat_messages') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'chat_sessions') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'compliance_requests') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_requests_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "compliance_requests" ADD CONSTRAINT "compliance_requests_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'critical_data_backups') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'critical_data_backups_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "critical_data_backups" ADD CONSTRAINT "critical_data_backups_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'custom_plugins') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_plugins_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "custom_plugins" ADD CONSTRAINT "custom_plugins_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'dashboard_layouts') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_layouts_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'data_retention_policies') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_retention_policies_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'dead_letter_queue') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dead_letter_queue_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "dead_letter_queue" ADD CONSTRAINT "dead_letter_queue_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'document_folders') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_folders_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'edit_history') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edit_history_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "edit_history" ADD CONSTRAINT "edit_history_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'email_clicks') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_clicks_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "email_clicks" ADD CONSTRAINT "email_clicks_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'email_opens') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_opens_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "email_opens" ADD CONSTRAINT "email_opens_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'field_snapshots') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_snapshots_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "field_snapshots" ADD CONSTRAINT "field_snapshots_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'kb_articles') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_articles_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'kb_categories') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_categories_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_warming_campaigns') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_campaigns_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "lead_warming_campaigns" ADD CONSTRAINT "lead_warming_campaigns_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_warming_messages') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_messages_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "lead_warming_messages" ADD CONSTRAINT "lead_warming_messages_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_warming_replies') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_replies_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "lead_warming_replies" ADD CONSTRAINT "lead_warming_replies_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_warming_schedule') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_schedule_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "lead_warming_schedule" ADD CONSTRAINT "lead_warming_schedule_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'milestones') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestones_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "milestones" ADD CONSTRAINT "milestones_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'page_views') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_views_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "page_views" ADD CONSTRAINT "page_views_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'plugin_execution_logs') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plugin_execution_logs_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "plugin_execution_logs" ADD CONSTRAINT "plugin_execution_logs_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'portal_clients') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_clients_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "portal_clients" ADD CONSTRAINT "portal_clients_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'project_tasks') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_tasks_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'projects') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'saved_views') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_views_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'scheduled_reports') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reports_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'service_subscriptions') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_subscriptions_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "service_subscriptions" ADD CONSTRAINT "service_subscriptions_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'signing_events') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signing_events_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "signing_events" ADD CONSTRAINT "signing_events_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'signing_requests') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signing_requests_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sla_breaches') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sla_breaches_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sla_policies') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sla_policies_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sms_messages') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_messages_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sms_templates') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_templates_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tax_exemptions') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_exemptions_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tax_rates') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_rates_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tenant_templates') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_templates_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "tenant_templates" ADD CONSTRAINT "tenant_templates_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'territories') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'territories_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "territories" ADD CONSTRAINT "territories_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'territory_assignments') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'territory_assignments_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "territory_assignments" ADD CONSTRAINT "territory_assignments_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'user_usage') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_usage_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "user_usage" ADD CONSTRAINT "user_usage_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'visitors') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "visitors" ADD CONSTRAINT "visitors_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_queue') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_queue_tenant_id_tenants_id_fk') THEN
      ALTER TABLE "webhook_queue" ADD CONSTRAINT "webhook_queue_tenant_id_tenants_id_fk"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;


-- ============================================================================
-- ADD FK: created_by -> users(id) ON DELETE SET NULL
-- ============================================================================

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'dashboard_layouts') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_layouts_created_by_users_id_fk') THEN
      ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'field_snapshots') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_snapshots_created_by_users_id_fk') THEN
      ALTER TABLE "field_snapshots" ADD CONSTRAINT "field_snapshots_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'kb_articles') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_articles_created_by_users_id_fk') THEN
      ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'kb_categories') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_categories_created_by_users_id_fk') THEN
      ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'projects') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_created_by_users_id_fk') THEN
      ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'scheduled_reports') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reports_created_by_users_id_fk') THEN
      ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'service_subscriptions') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_subscriptions_created_by_users_id_fk') THEN
      ALTER TABLE "service_subscriptions" ADD CONSTRAINT "service_subscriptions_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;
