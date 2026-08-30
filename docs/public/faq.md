# Frequently Asked Questions

Quick answers to common questions. See the [Glossary](./glossary.md) for terminology.

---

## Accounts & access

**How do I get access to NuCRM?**
Either sign up to create a new workspace, or accept an email invitation from a colleague. See
[Getting Started](./getting-started.md).

**I forgot my password.**
Use *Forgot password* on the login page to receive a reset link by email.

**Why am I asked for a code after my password?**
Your workspace requires **two-factor authentication (2FA)**. Enter the code from your authenticator
app. See [Security Settings](./admin-guide/security-settings.md).

**Can we log in with our company's SSO?**
Yes — NuCRM supports SAML, OpenID Connect, and OAuth 2.0. An admin configures it in
[Security Settings](./admin-guide/security-settings.md).

---

## Using NuCRM

**How do I import my existing data?**
Most modules (contacts, leads) support CSV **import** with column mapping and duplicate detection.
See [Contacts & Companies](./user-guide/contacts-and-companies.md#import--export).

**I deleted something by mistake — can I get it back?**
Yes. Destructive actions show a 10-second **undo** toast, and deleted records go to **Trash** where
you can restore them before auto-cleanup.

**How do I move a deal through my pipeline?**
Drag it between columns on the Kanban board. See
[Deals & Pipelines](./user-guide/deals-and-pipelines.md).

**How do I automate repetitive work?**
Use the visual **workflow builder**, **automation rules**, or **sequences**. See
[Automation & Workflows](./user-guide/automation.md).

---

## Communication

**Which email/SMS/WhatsApp providers are supported?**
Email via Resend or SMTP; SMS/voice via Twilio; WhatsApp via the Meta WhatsApp Business API. An
admin connects these in [Integrations](./admin-guide/integrations.md).

**Why aren't my invites or emails sending?**
Email must be configured. If no email provider is set up, invitations, password resets, and
notifications won't send. Ask your admin to configure a provider.

---

## Billing & plans

**What happens when I hit a plan limit?**
NuCRM warns you as you approach limits and may block the action until you upgrade or free capacity.
See [Billing & Plans](./admin-guide/billing-and-plans.md).

**Which payment methods are accepted?**
Depending on your region, payments are processed via Stripe, Razorpay, or PayU.

---

## AI

**How is AI usage measured?**
Each workspace has **AI credits**. Usage draws down the balance; admins can view usage and set
limits. See [AI Features](./user-guide/ai-features.md).

**Is my data used to train AI models?**
AI features send the record context you provide to a configured provider to fulfill the request.
Follow your organization's data-handling policies; your admin controls provider configuration.

---

## Developers

**Where's the API documentation?**
See the [Developer & API Reference](./developer/README.md), the
[OpenAPI spec](../../public/api/openapi.yaml), or the interactive Swagger UI at `/api-docs`.

**Is there an SDK?**
Yes — an official TypeScript SDK. See [SDK](./developer/sdk.md).

**How do I get webhook events?**
Configure outbound webhooks and verify them with the SDK. See [Webhooks](./developer/webhooks.md).

---

## Still stuck?

Contact your workspace administrator, or if you operate the platform, see the
[Super-Admin Docs](../admin/README.md) and [Troubleshooting](../TROUBLESHOOTING.md).
