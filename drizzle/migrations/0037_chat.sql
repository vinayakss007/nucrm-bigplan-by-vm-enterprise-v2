CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "visitor_id" text NOT NULL,
  "visitor_name" text,
  "visitor_email" text,
  "assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'waiting',
  "channel" text DEFAULT 'web',
  "converted_lead_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_tenant" ON "chat_sessions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_status" ON "chat_sessions" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_visitor" ON "chat_sessions" ("visitor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_assigned" ON "chat_sessions" ("assigned_to");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sender_type" text NOT NULL,
  "sender_id" text,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_messages_session" ON "chat_messages" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_messages_tenant" ON "chat_messages" ("tenant_id");
