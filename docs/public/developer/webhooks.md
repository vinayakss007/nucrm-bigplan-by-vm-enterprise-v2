# Webhooks

Receive NuCRM events in your own systems instead of polling the API.

---

## Outbound webhooks

Configure **outbound webhooks** to have NuCRM POST an event payload to your endpoint whenever
something happens in a workspace (e.g. a contact is created, a deal is won).

- Configure endpoints under **Settings → Webhooks** (see
  [Integrations](../admin-guide/integrations.md)).
- Delivery is **reliable**: failed deliveries are retried, and permanently failing deliveries land
  in a **dead-letter queue** for inspection.
- Delivery attempts are logged so you can audit what was sent.

### Payload

Webhooks deliver a JSON body describing the event type and the affected record. Your endpoint
should respond quickly with a `2xx` status; do heavy processing asynchronously.

---

## Verifying webhooks

Always verify that an incoming webhook really came from NuCRM before trusting it. The SDK provides
`WebhookVerifier` and `WebhookRouter`:

```ts
import { WebhookVerifier, WebhookRouter } from '@nucrm/sdk';

const verifier = new WebhookVerifier({ secret: process.env.NUCRM_WEBHOOK_SECRET });

// In your HTTP handler:
const isValid = verifier.verify(rawBody, signatureHeader);
if (!isValid) return res.status(401).end();

const router = new WebhookRouter();
router.on('deal.won', async (event) => { /* ... */ });
router.on('contact.created', async (event) => { /* ... */ });
await router.handle(event);
```

---

## Inbound webhooks

NuCRM can also **receive** webhooks from external systems into a workspace, letting third-party
events create or update CRM data. There are tenant-scoped inbound endpoints for this purpose.

---

## Provider webhooks

NuCRM consumes webhooks from the services it integrates with, including:

- **Stripe**, **Razorpay**, **PayU** — billing/payment events
- **Resend** — email delivery events
- **WhatsApp** — inbound messages
- **Telegram** — bot events

These are handled internally; you don't need to configure them unless you're operating the platform
(see [Super-Admin → Integrations/Configuration](../../admin/configuration.md)).

---

## Related

- [SDK](./sdk.md) — `WebhookVerifier` / `WebhookRouter`
- [Automation & Workflows](../user-guide/automation.md) — trigger webhooks from workflows
- [Integrations](../admin-guide/integrations.md) — configure endpoints
