CREATE TABLE IF NOT EXISTS "visitors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "fingerprint_id" text NOT NULL,
  "identified_contact_id" uuid,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "total_page_views" integer DEFAULT 0 NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "page_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "visitor_id" uuid NOT NULL,
  "url" text NOT NULL,
  "title" text DEFAULT '',
  "referrer" text DEFAULT '',
  "duration_seconds" integer DEFAULT 0,
  "viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
