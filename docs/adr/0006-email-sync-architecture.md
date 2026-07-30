# ADR-0006: Two-Way Email Sync Architecture

## Status

Proposed

## Context

NuCRM needs two-way email synchronization to auto-log emails on deals/contacts
and allow sending directly from the CRM. Currently, outbound email works via
Resend/SMTP but inbound (replies, forwarded emails) is not captured.

## Decision

### Inbound Email (receive)

Use a **webhook-based inbound parse** service:

1. **Mailgun Inbound Routes** or **SendGrid Inbound Parse** or **Resend webhooks**
2. Configure a subdomain: `mail.nucrm-tenant.com` with MX pointing to the provider
3. Provider sends parsed email to `POST /api/webhooks/inbound-email`
4. Webhook handler:
   - Verifies signature (HMAC)
   - Extracts: from, to, subject, body (text + html), attachments
   - Matches sender email to a contact/lead in the tenant
   - Creates an activity record linked to the contact/deal
   - Stores raw email in `email_messages` table

### Outbound Email (send from CRM)

Already implemented via:

- `lib/email/service.ts` → Resend API or SMTP
- `POST /api/tenant/email/test-send` for single emails
- `POST /api/tenant/email/bulk` for campaigns

Enhancement needed:

- Add `reply_to` header set to the tenant's inbound address
- Store outbound emails in `email_messages` table
- Link to contact/deal via entity_id

### Email Threading

- Match by `In-Reply-To` / `References` headers
- Fall back to subject line matching (RE: prefix + original subject)
- Group into threads by `thread_id` (generated on first email, propagated via headers)

### Storage

```sql
CREATE TABLE email_messages (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  thread_id UUID,
  direction TEXT NOT NULL, -- 'inbound' | 'outbound'
  from_email TEXT NOT NULL,
  to_emails TEXT[] NOT NULL,
  cc_emails TEXT[],
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  contact_id UUID REFERENCES contacts(id),
  deal_id UUID REFERENCES deals(id),
  in_reply_to TEXT,
  message_id TEXT UNIQUE,
  headers JSONB,
  attachments JSONB, -- [{filename, size, content_type, s3_key}]
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Consequences

### Positive

- Sales reps see full email history on deal/contact without leaving CRM
- Replies auto-logged — no manual "log email" step
- Thread view groups conversations naturally
- Works with any email provider (not tied to Gmail/Outlook)

### Negative

- Requires DNS configuration per tenant (MX records for inbound)
- Inbound parsing adds webhook processing load
- Email storage grows rapidly (consider archiving after 90 days)
- Attachments stored in S3 increase storage costs

## Alternatives Considered

1. **Gmail/Outlook API sync** — More complete (access to existing inbox) but requires OAuth per user, complex token management, and each provider is different. Deferred to Phase 2.

2. **BCC-based logging** — User adds a BCC address to every email. Low-friction but unreliable (users forget). Can be offered as a fallback.

3. **Browser extension** — Inject CRM sidebar into Gmail/Outlook web. High development cost, browser-specific, maintenance burden. Rejected.

## Implementation Plan

| Phase | Scope                                                     | Effort |
| ----- | --------------------------------------------------------- | ------ |
| 1     | Inbound webhook + email_messages table + activity logging | 8h     |
| 2     | Outbound storage + reply threading                        | 4h     |
| 3     | Email UI page (inbox view per contact/deal)               | 6h     |
| 4     | Gmail/Outlook OAuth sync (optional)                       | 16h    |
