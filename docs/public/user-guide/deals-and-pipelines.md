# Deals & Pipelines

A **deal** (opportunity) represents a potential sale. **Pipelines** organize deals into stages so
you can see and forecast your sales.

---

## Pipelines & stages

A **pipeline** is an ordered set of **stages** (e.g. *Qualification → Proposal → Negotiation →
Won/Lost*). Workspaces can have multiple pipelines for different sales processes.

- Admins configure pipelines and stages in **Settings → Pipelines**.
- Each stage can carry a probability used in forecasting.

---

## The Kanban board

Deals are shown on a **drag-and-drop Kanban board** grouped by stage:

- **Drag a deal** between columns to move it to a new stage.
- **Stage automation** can fire when a deal enters or leaves a stage (e.g. create a task,
  send an email) — see [Automation](./automation.md).
- Switch to a **list view** for filtering, sorting, and bulk actions.

---

## Deal details

| Field / feature | Description |
| --- | --- |
| **Value & currency** | Deal amount, with **multi-currency** support and automatic conversion using exchange rates. |
| **Stage & probability** | Current stage and its win probability. |
| **Products** | Line items linking catalog products to the deal. |
| **Owner** | The rep responsible; assignable manually or by rules. |
| **Linked records** | Associated contact(s) and company. |
| **Timeline** | All activity and stage changes over time. |

---

## Forecasting

NuCRM produces **forecasts** from your open deals, weighting value by stage probability and close
date. Use forecasts to project revenue and spot gaps early. See
[Reports & Dashboards](./reports-and-dashboards.md) for revenue analytics and projections.

---

## Multi-currency

Deals can be recorded in different currencies. Values convert automatically using stored exchange
rates so pipeline totals and forecasts roll up consistently in your base currency.

---

## Tips

- Keep stages moving — stale deals are easy to spot on the board.
- Attach **products** to deals so quotes and invoices can be generated from the same data.
- Use **automation** to create follow-up tasks when a deal stalls.

---

## Related

- [Leads](./leads.md) — leads convert into deals
- [Sales Documents](./sales-documents.md) — turn won deals into quotes/invoices/orders
- [Automation & Workflows](./automation.md) — stage-based automation
- [Reports & Dashboards](./reports-and-dashboards.md) — forecasts and pipeline analytics
