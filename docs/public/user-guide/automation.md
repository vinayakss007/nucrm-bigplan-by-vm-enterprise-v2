# Automation & Workflows

Automate repetitive work so your team focuses on customers. NuCRM offers a visual workflow builder,
email sequences, event-based rules, assignment routing, and lead warming.

---

## Workflows

The **visual workflow builder** lets you design multi-step automations on a drag-and-drop canvas.

- **Triggers** start a workflow (e.g. a record is created or changes).
- **Conditions** branch the flow based on record data.
- **Actions** do the work — create tasks, send emails, update fields, call webhooks, and more.
- Every run is logged, so you can see exactly what happened and troubleshoot.

Build workflows in the **Workflows** module.

---

## Automation rules

**Automation rules** are event-based "if this, then that" automations that react to CRM events
such as:

- `contact.created`
- `deal.won`
- stage changes, and other record events.

Rules are ideal for straightforward reactions; use workflows when you need branching or multiple
steps.

---

## Email sequences

**Sequences** are drip campaigns that send a series of emails over time.

| Feature | Description |
| --- | --- |
| **Steps** | Ordered email steps with delays between them. |
| **Template variables** | Personalize each step with record data. |
| **Enrollment** | Enroll contacts/leads into a sequence. |
| **Step logs** | Track what was sent and when. |

Sequences are processed in the background on a schedule.

---

## Assignment rules

**Assignment rules** automatically route new leads/contacts to the right owner:

- Match on attributes (source, region, size, …).
- **Round-robin** and **load balancing** across a team.
- Combine with **territories** for geography- or account-based routing.

---

## Lead warming

**Lead warming** nurtures leads with automated, scheduled touchpoints:

- Warming **campaigns** with scheduled messages.
- **Reply tracking** to detect engagement and pause warming when a lead responds.
- Works alongside email **warmup** to protect deliverability.

---

## Follow-up automation

Automatically **create follow-ups** and **detect missed follow-ups** so no relationship goes cold.
See [Tasks, Activities & Calendar](./tasks-and-activities.md#follow-ups).

---

## Approvals

Route documents and actions (e.g. discounted quotes, contracts) through **approval workflows** so
the right person signs off before things proceed.

---

## Related

- [Communication](./communication.md) — the channels automations send through
- [Leads](./leads.md) — scoring and routing
- [Developer → Webhooks](../developer/webhooks.md) — trigger external systems from automations
