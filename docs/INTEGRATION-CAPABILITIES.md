# NuCRM Integration Capabilities

> **Complete guide to all external tool connections**
>
> **Last Updated**: June 28, 2026

---

## Overview

NuCRM supports multiple ways to connect with external tools for **pushing data out** and **retrieving data in**.

---

## 1. WEBHOOKS (Outbound) ✅

### What It Does
Sends HTTP POST requests to external URLs when events happen in NuCRM.

### Supported Events
| Event | Description |
|-------|-------------|
| `contact.created` | New contact added |
| `contact.updated` | Contact modified |
| `contact.deleted` | Contact removed |
| `deal.created` | New deal created |
| `deal.updated` | Deal modified |
| `deal.stage_changed` | Deal moved to new stage |
| `deal.won` | Deal closed won |
| `deal.lost` | Deal closed lost |
| `lead.created` | New lead |
| `lead.converted` | Lead converted to deal |
| `task.created` | New task |
| `task.completed` | Task marked done |
| `invoice.created` | Invoice generated |
| `invoice.paid` | Payment received |
| `form.submitted` | Form submission |

### Webhook Payload Format
```json
{
  "event": "contact.created",
  "timestamp": "2026-06-28T10:00:00Z",
  "tenant_id": "tnt_xxx",
  "data": {
    "id": "cnt_xxx",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com"
  }
}
```

### Security Features
- HMAC-SHA256 signature verification
- Retry with exponential backoff (5min → 30min → 2hr → 12hr)
- Dead letter queue for failed deliveries
- Delivery logs and stats

### Setup
```
Tenant Settings → Integrations → Webhooks → Add Webhook
```

---

## 2. INBOUND WEBHOOKS (Data In) ✅

### What It Does
Receive data from external tools via HTTP POST to NuCRM.

### Endpoint
```
POST /api/webhooks/inbound
Header: x-api-key: ak_live_xxxxx
```

### Payload Format
```json
{
  "action": "create_contact",
  "data": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1-555-0100",
    "source": "zapier"
  }
}
```

### Supported Actions
| Action | Description |
|--------|-------------|
| `create_contact` | Create new contact |
| `update_contact` | Update existing contact |
| `create_deal` | Create new deal |
| `create_lead` | Create new lead |
| `create_company` | Create new company |
| `create_task` | Create new task |

---

## 3. API KEYS (External Access) ✅

### What It Does
External tools can access NuCRM API using API keys.

### Generate API Key
```
Tenant Settings → API Keys → Create Key
```

### Use API Key
```bash
curl -H "Authorization: Bearer ak_live_xxxxx" \
  http://localhost:3000/api/tenant/contacts
```

### Scoped Permissions
| Scope | Description |
|-------|-------------|
| `*` | Full access |
| `contacts:read` | Read contacts |
| `contacts:write` | Create/update contacts |
| `deals:all` | Full deal access |
| `leads:all` | Full lead access |

### Benefits
- Bypasses CSRF protection
- Scoped permissions
- Usage logging
- Can be revoked anytime

---

## 4. BUILT-IN INTEGRATIONS ✅

### Email Providers
| Provider | Actions | Status |
|----------|---------|--------|
| **SendGrid** | Send email, Add contact | ✅ Built-in |
| **Mailgun** | Send email | ✅ Built-in |
| **Resend** | Receive webhooks | ✅ Built-in |

### Messaging
| Provider | Actions | Status |
|----------|---------|--------|
| **Slack** | Send messages | ✅ Built-in |
| **WhatsApp** | Send/receive messages | ✅ Built-in |

### AI Providers
| Provider | Actions | Status |
|----------|---------|--------|
| **OpenAI** | Generate, Summarize, Draft | ✅ Built-in |
| **Anthropic** | Via AI gateway | ✅ Built-in |
| **Custom AI** | Any OpenAI-compatible API | ✅ Built-in |

### Payments
| Provider | Actions | Status |
|----------|---------|--------|
| **Stripe** | Subscriptions, Invoices | ✅ Built-in |

---

## 5. CUSTOM API INTEGRATION (AI Connector) ✅

### What It Does
Connect to **ANY REST API** using AI-powered auto-discovery.

### How It Works
1. Enter API base URL and key
2. AI guesses the API patterns
3. Automatically makes correct API calls

### Supported API Patterns
| Pattern | Example |
|---------|---------|
| Email sending | `/mail/send`, `/send`, `/messages` |
| Contact creation | `/contacts`, `/crm/contacts` |
| List resources | `/users`, `/items`, `/records` |
| Generic POST | Any endpoint |

### Pre-configured Base URLs
```
Stripe:      https://api.stripe.com/v1
GitHub:      https://api.github.com
HubSpot:     https://api.hubapi.com
Salesforce:  https://your-instance.salesforce.com/services/data/v58.0
Mailchimp:   https://us1.api.mailchimp.com/3.0
Twilio:      https://api.twilio.com/2010-04-01
Discord:     https://discord.com/api
Notion:      https://api.notion.com/v1
Asana:       https://app.asana.com/api/1.0
Trello:      https://api.trello.com/1
Google:      https://www.googleapis.com
```

### Setup
```
Tenant Settings → Integrations → Add Custom → Enter URL + API Key
```

---

## 6. PLUGIN SYSTEM ✅

### What It Does
Extensible plugin architecture for custom integrations.

### Plugin Types
| Type | Description |
|------|-------------|
| `webhook` | Outbound webhooks |
| `inbound` | Inbound data receivers |
| `action` | Custom actions |
| `connector` | Two-way sync |

### Plugin Capabilities
- Custom endpoint definitions
- Field mapping
- Transformation logic
- Error handling
- Retry policies

---

## 7. ZAPIER / MAKE.COM COMPATIBILITY ✅

### How It Works
Via Inbound Webhooks + API Keys

### Zapier Setup
1. **Trigger**: NuCRM → Webhook (outbound)
2. **Action**: Webhook → NuCRM inbound endpoint

### Make.com Setup
1. **Module**: HTTP → Make request to NuCRM API
2. **Auth**: API Key in header

### Example Zapier Zap
```
Trigger: NuCRM contact.created webhook
Action: Slack notification
```

### Example Make.com Scenario
```
Trigger: Google Form submission
Action: POST to /api/webhooks/inbound (create_contact)
```

---

## 8. DATA EXPORT/IMPORT ✅

### Export Options
| Format | Endpoint | Description |
|--------|----------|-------------|
| CSV | `/api/tenant/contacts/export` | Export contacts |
| JSON | `/api/tenant/contacts/export?format=json` | JSON format |
| Bulk | `/api/tenant/data-export` | Full tenant export |

### Import Options
| Format | Endpoint | Description |
|--------|----------|-------------|
| CSV | `/api/tenant/contacts/import` | Import contacts |
| CSV | `/api/tenant/leads/import` | Import leads |
| Bulk | `/api/tenant/data-import` | Full import |

---

## 9. CALENDAR SYNC ✅

### Supported
| Provider | Status |
|----------|--------|
| Google Calendar | Via OAuth SSO |
| Outlook | Via OAuth SSO |
| CalDAV | Generic support |

### Events Synced
- Meetings
- Tasks with due dates
- Follow-ups

---

## 10. SSO / OAUTH ✅

### Supported Providers
| Provider | Status |
|----------|--------|
| Google | ✅ Built-in |
| Microsoft | ✅ Built-in |
| Custom OIDC | ✅ Supported |

### Use Cases
- Single sign-on
- Calendar sync
- Contact import from Google/Microsoft

---

## 11. EMAIL INTEGRATION ✅

### Inbound Email
- Parse incoming emails
- Create contacts from emails
- Thread conversations

### Outbound Email
- SendGrid, Mailgun, Resend
- Email templates
- Bulk sending
- Open/click tracking

---

## 12. WHATSAPP INTEGRATION ✅

### Features
- Send/receive messages
- Template management
- Conversation tracking
- Media support

---

## SUMMARY TABLE

| Integration | Push Data Out | Retrieve Data In | Status |
|-------------|---------------|------------------|--------|
| Webhooks | ✅ | ✅ | Built-in |
| API Keys | ✅ | ✅ | Built-in |
| SendGrid | ✅ | ❌ | Built-in |
| Mailgun | ✅ | ❌ | Built-in |
| Slack | ✅ | ❌ | Built-in |
| WhatsApp | ✅ | ✅ | Built-in |
| OpenAI | ✅ | ❌ | Built-in |
| Stripe | ✅ | ✅ | Built-in |
| Custom API | ✅ | ✅ | AI-powered |
| Zapier | ✅ | ✅ | Via webhooks |
| Make.com | ✅ | ✅ | Via webhooks |
| HubSpot | ✅ | ✅ | Via AI connector |
| Salesforce | ✅ | ✅ | Via AI connector |
| Notion | ✅ | ✅ | Via AI connector |
| Google | ✅ | ✅ | Via OAuth |
| Outlook | ✅ | ✅ | Via OAuth |

---

## RECOMMENDED INTEGRATION PATTERNS

### For Zapier/Make.com Users
```
NuCRM Webhook → Zapier/Make → External Tool
External Tool → Zapier/Make → NuCRM Inbound Webhook
```

### For Developer Integrations
```
External App → NuCRM API (with API key)
```

### For Non-Technical Users
```
NuCRM → Built-in Integrations (Slack, SendGrid, etc.)
```

### For Custom Tools
```
NuCRM → Custom API Integration (AI-powered)
```

---

## NEED MORE INTEGRATIONS?

The system is designed to be extensible. To add a new integration:

1. **Built-in Provider**: Add to `lib/integrations/providers/`
2. **Plugin**: Create a plugin in `lib/plugins/`
3. **Custom API**: Use the AI Connector (works with any REST API)
4. **Webhook**: Use inbound/outbound webhooks
