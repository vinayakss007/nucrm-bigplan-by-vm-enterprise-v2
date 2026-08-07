# nucrm — Product Vision

## One-liner

**nucrm is a standalone CRM.** Platform features (custom entities, webhooks, SDK) extend it later.

---

## The Product

### Phase 1: Standalone CRM (Now)

A complete CRM that works out of the box:

| Module         | What It Does                       |
| -------------- | ---------------------------------- |
| **Leads**      | Capture, score, warm up leads      |
| **Contacts**   | People & companies                 |
| **Deals**      | Pipeline, stages, value tracking   |
| **Invoicing**  | Quotes → Invoices → Payments       |
| **Follow-ups** | Automated email/WhatsApp sequences |
| **Forms**      | Lead capture forms                 |
| **Email**      | Templates, bulk send, tracking     |
| **Dashboard**  | Activity, revenue, pipeline views  |

**This is what we sell.** A business pays for this and uses it day-to-day.

### Phase 2: Platform Extensions (Later)

Features that let power users customize and extend:

| Feature         | What It Does                                          |
| --------------- | ----------------------------------------------------- |
| Custom Entities | Create new data types (e.g., "properties", "courses") |
| Webhooks        | Integrate with external tools                         |
| SDK             | Build custom UIs or integrations                      |
| API             | Programmatic access                                   |
| Plugins         | Third-party extensions                                |
| Automation      | Custom workflows beyond follow-ups                    |

**This is what differentiates us** from Salesforce/HubSpot for small teams.

---

## Who Is This For?

| Persona            | What They Need                               | Price Point |
| ------------------ | -------------------------------------------- | ----------- |
| **Small agency**   | Manage clients, send invoices, follow up     | $29-99/mo   |
| **Freelancer**     | Track leads, send quotes, get paid           | $19-49/mo   |
| **Small business** | All-in-one CRM without enterprise complexity | $49-199/mo  |

---

## What Exists Today

| Module          | Status     | Notes                            |
| --------------- | ---------- | -------------------------------- |
| Leads           | ✅ Built   | Scoring, warming, bulk email     |
| Contacts        | ✅ Built   | People + companies               |
| Deals           | ✅ Built   | Pipeline, stages                 |
| Invoicing       | ⚠️ Partial | Quotes exist, invoices partially |
| Follow-ups      | ✅ Built   | Automation, sequences            |
| Forms           | ✅ Built   | Lead capture                     |
| Email           | ✅ Built   | Templates, bulk                  |
| Dashboard       | ✅ Built   | Activity, revenue                |
| Auth            | ✅ Built   | Login, SSO, roles                |
| Multi-tenant    | ✅ Built   | RLS, tenant isolation            |
| Webhooks        | ⚠️ Built   | Tables exist, API exists         |
| Custom Entities | ⚠️ Built   | Tables exist, API exists         |
| SDK             | ⚠️ Built   | 20+ resources                    |

---

## What To Build Next

### Priority 1: Ship the CRM (Week 1-2)

- [ ] Fix invoicing (quotes → invoices → payments)
- [ ] Fix deal creation (stage_name vs stage bug)
- [ ] Ensure all modules work end-to-end
- [ ] Test the full user flow: lead → contact → deal → invoice → payment

### Priority 2: Production Ready (Week 3-4)

- [ ] S3 file storage (files lost on restart)
- [ ] Stripe billing (subscriptions, metering)
- [ ] Email delivery (Resend/SendGrid)
- [ ] Backup/restore

### Priority 3: Platform Extensions (Month 2+)

- [ ] Clean up custom entity API
- [ ] Webhook reliability (retry, DLQ)
- [ ] SDK documentation
- [ ] API versioning

---

## The Question That Matters

**Can a small agency owner sign up, import their leads, send a quote, get paid, and follow up with clients — without calling support?**

If yes, we have a product.
If no, we have a tech demo.

---

_Last updated: 2026-08-06_
