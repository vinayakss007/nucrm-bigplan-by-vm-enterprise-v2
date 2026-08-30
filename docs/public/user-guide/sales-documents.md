# Sales Documents

NuCRM covers the full **quote-to-cash** flow: products, quotes, orders, invoices, contracts, and
subscriptions.

---

## Products & price books

The **product catalog** holds the items and services you sell.

| Feature | Description |
| --- | --- |
| **SKU & pricing** | Each product has a code and price. |
| **Tax rates** | Assign tax treatment per product. |
| **Price books** | Maintain multiple price lists (e.g. by region or customer tier). |
| **Product templates** | Reusable product definitions for quick entry. |

Products flow into deals, quotes, orders, and invoices as **line items**.

---

## Quotes

A **quote** proposes pricing to a customer.

- Build quotes from **line items** (products with quantity, price, and tax).
- Generate a **PDF** to send to the customer.
- Route quotes through an **approval workflow** when discounts or terms need sign-off.
- Share a **public offer link** so customers can view — and accept or decline — without logging in.
  See [Offers](#offers).

---

## Orders

**Orders** capture confirmed purchases.

- Line items, shipping details, and **status tracking** through fulfillment.
- Created from accepted quotes or directly.

---

## Invoices

**Invoices** bill the customer and track payment.

| Feature | Description |
| --- | --- |
| **Line items & tax** | Automatic tax calculation across jurisdictions. |
| **Payment tracking** | Payments are recorded against the invoice; balance due and status update automatically. |
| **Recurring invoices** | Generate invoices on a schedule for ongoing services. |
| **PDF generation** | Produce a professional PDF for sending. |

> Payments are stored as an append-only ledger, so the invoice's paid amount, balance, and status
> are always derived from the recorded payments and can't silently drift.

Customers can view and download their invoices through the
[Customer Portal](../customer-portal.md).

---

## Contracts

**Contracts** manage agreements over time:

- **Renewal tracking** with automatic reminders before expiry.
- **Approval workflow** for sign-off.

---

## Subscriptions

**Subscriptions** handle recurring revenue:

- Recurring billing cycles.
- **Trial management**.
- **Plan upgrades / downgrades** with proration handled by billing.

---

## Offers

**Offers** are shareable, public proposals. Send a customer a link (no login required) where they
can review the offer and **accept** or **decline** it. The response is recorded back in NuCRM.

---

## Tax & currency

- **Tax** — configurable tax rates, exemptions, and multi-jurisdiction calculation applied
  automatically to line items.
- **Currency** — multi-currency documents with exchange-rate conversion.

---

## Related

- [Deals & Pipelines](./deals-and-pipelines.md) — deals become quotes and orders
- [Billing & Plans](../admin-guide/billing-and-plans.md) — your workspace's own subscription
- [Customer Portal Guide](../customer-portal.md) — where customers view invoices
