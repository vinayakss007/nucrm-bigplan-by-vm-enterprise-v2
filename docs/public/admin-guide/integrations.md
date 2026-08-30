# Integrations

Connect NuCRM to the tools you already use: email, messaging, telephony, calendars, and any API via
the plugin engine.

> 👤 **Tenant admin** — configure under **Settings → Integrations** (and related settings pages).

---

## Email

Email powers invites, notifications, and outbound customer email. Configure a provider:

- **Resend** — recommended; add your API key and a verified sending domain.
- **SMTP** — a fallback for any SMTP server (host, port, user, password).

Once configured you can send templated and bulk email with open/click tracking. See
[Communication → Email](../user-guide/communication.md#email).

> If neither provider is configured, email will not send — invites and password resets depend on
> it.

---

## SMS & voice (Twilio)

Connect **Twilio** to send SMS and place/record calls:

- Provide your Twilio account SID, auth token, and phone number.
- Enables SMS templates, inbound messages, and the integrated dialler.

See [Communication → SMS](../user-guide/communication.md#sms) and
[Calls](../user-guide/communication.md#calls).

---

## WhatsApp (Meta)

Connect a **WhatsApp Business** account (Meta Cloud API) to message customers on WhatsApp:

- Provide your phone number ID, access token, business account ID, and webhook verify token.
- Enables template and free-text messaging with conversation tracking.

See [Communication → WhatsApp](../user-guide/communication.md#whatsapp).

---

## Calendar sync

Sync meetings with:

- **Google Calendar**
- **Outlook / Microsoft 365**

Connect your account under Integrations to keep meetings in sync both ways. See
[Tasks & Calendar → Calendar sync](../user-guide/tasks-and-activities.md#calendar-sync).

---

## Telegram

Connect a **Telegram bot** to receive notifications and interact with your workspace from Telegram.

---

## Plugin engine — connect any API

The **plugin engine** lets you integrate services that don't have a built-in connector, using just
a **base URL** and **credentials**.

| Capability | Detail |
| --- | --- |
| **Auth types** | Bearer token, basic auth, API key (header or query), OAuth2 client credentials, or none. |
| **Variable interpolation** | Insert record data into requests with `{{variable}}` placeholders. |
| **Built-in providers** | Common services (e.g. SendGrid, Slack, Mailgun, OpenAI) are recognized. |
| **Execution logs** | Every plugin call is logged for troubleshooting. |
| **Safety** | Outbound requests are protected against SSRF and time out if unresponsive. |

Build and manage plugins under **Settings → Plugins**.

---

## Webhooks

- **Outbound webhooks** — send NuCRM events to your systems, with retries and a dead-letter queue.
  See [Developer → Webhooks](../developer/webhooks.md).
- **Inbound webhooks** — receive events from external systems into NuCRM.

---

## API keys

Generate **API keys** under **Settings → API keys** for programmatic access. Keys are scoped to
your workspace. See [Developer → Authentication](../developer/authentication.md).

---

## Related

- [Developer & API Reference](../developer/README.md) — build custom integrations
- [Security Settings](./security-settings.md) — protect connected access
