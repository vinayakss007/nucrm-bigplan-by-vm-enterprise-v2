# Leads

A **lead** is a potential customer who has shown interest but hasn't yet been qualified into a
contact + deal. NuCRM helps you capture, score, route, and convert leads.

---

## Capturing leads

Leads can arrive from several sources:

- **Manually** — Leads → *New Lead*.
- **Web forms** — public forms and embeddable form scripts create leads on submission. See
  [Embeds & Forms](../developer/embeds-and-forms.md).
- **Import** — upload a CSV of leads.
- **API** — create leads programmatically. See the [REST API Reference](../developer/rest-api.md).

Each lead records its **source**, so you can measure which channels perform best.

---

## Lead scoring

Leads are scored automatically to help you focus on the best opportunities:

- **BANT-style scoring** (Budget, Authority, Need, Timeline) combined with rule-based signals.
- **Custom scoring rules** — your admin can define rules that add or subtract points based on
  attributes and behavior.
- Scores recalculate on a schedule and as leads change.

Higher-scoring leads surface first so your team spends time where it counts.

---

## Assignment & distribution

Leads can be routed to the right rep automatically:

- **Assignment rules** — match leads on attributes (region, source, size, …) and assign an owner.
- **Round-robin & load balancing** — distribute evenly across a team.
- **Territories** — route by geographic or account territory.

Configure these in the Workspace Admin area — see
[Automation → Assignment Rules](./automation.md#assignment-rules).

---

## Working a lead

- Track **activities** (calls, emails, meetings) directly on the lead.
- Add **notes** and **tags**.
- Use **follow-ups** so no lead goes cold; missed follow-ups are detected and surfaced.
- **Lead warming** can nurture leads with automated touchpoints — see
  [Automation → Lead Warming](./automation.md#lead-warming).

---

## Converting a lead

When a lead is qualified, **convert** it. Conversion turns the lead into the appropriate records:

- a **contact** (and optionally a **company**), and
- an optional **deal** in your pipeline.

Activity history carries over so nothing is lost.

---

## Related

- [Contacts & Companies](./contacts-and-companies.md) — where qualified leads land
- [Deals & Pipelines](./deals-and-pipelines.md) — opportunities created on conversion
- [Automation & Workflows](./automation.md) — scoring, assignment, and warming
- [Reports & Dashboards](./reports-and-dashboards.md) — measure lead source performance
