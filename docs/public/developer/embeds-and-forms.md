# Embeds & Forms

Capture leads directly from your website into NuCRM.

---

## Web forms

NuCRM includes a **form builder** (in the Marketing/Forms area) for creating forms that capture
submissions as **leads** or contacts in your workspace.

- Build a form, define its fields, and publish it.
- Submissions are stored and can trigger [automation](../user-guide/automation.md) (scoring,
  assignment, notifications).

---

## Public form pages

Published forms can be hosted on a **public URL** so anyone can submit them without logging in.
Submissions flow straight into your workspace.

---

## Embeddable form script

To place a NuCRM form on your own website, use the **embeddable form script**. NuCRM serves a small
JavaScript snippet that renders your form inline on your site:

```html
<!-- Example: embed a NuCRM form on your page -->
<script src="https://your-domain.com/api/embed/form.js" async></script>
<div data-nucrm-form="<form-id>"></div>
```

The script renders the form and posts submissions back to NuCRM, creating leads/contacts and
firing any configured automations.

---

## Programmatic lead capture

You can also create leads directly via the API — useful when integrating a custom front end or a
third-party landing page builder:

```bash
curl -X POST https://your-domain.com/api/forms/submit \
  -H "Content-Type: application/json" \
  -d '{ "formId": "<form-id>", "data": { "email": "lead@example.com", "name": "New Lead" } }'
```

See the [REST API Reference](./rest-api.md) and the
[OpenAPI spec](../../../public/api/openapi.yaml) for exact fields.

---

## Related

- [Leads](../user-guide/leads.md) — what happens to captured leads
- [Automation & Workflows](../user-guide/automation.md) — route and nurture new leads
- [Branding & Customization](../admin-guide/branding-and-customization.md) — brand your forms/portal
