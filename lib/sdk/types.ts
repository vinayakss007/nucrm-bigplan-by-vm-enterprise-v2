/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * NuCRM SDK - Shared Types (public surface).
 *
 * Types for all CRM resources, pagination, errors, and webhook events.
 *
 * #422: this file was 592 lines, over the 500-line ceiling enforced by
 * `scripts/check-file-size.mjs`. The declarations now live in the same-named
 * directory (`lib/sdk/types/`), split by concern:
 *
 *   - `core.ts`                 — pagination, ApiError, RequestFn
 *   - `webhooks.ts`             — WebhookEventType / WebhookPayload
 *   - `resources-crm.ts`        — contacts, deals, leads, companies, tasks,
 *                                 tickets, meetings, activities + Create/Update
 *   - `resources-sales.ts`      — invoices, documents, quotes, orders,
 *                                 contracts, subscriptions, services + Create/Update
 *   - `resources-engagement.ts` — forms, sequences, automations, reports + Create/Update
 *   - `operations.ts`           — bulk, search, files, realtime, billing/usage,
 *                                 template/module catalog
 *
 * This module is a barrel so every importer (`lib/sdk/*.ts`, and anything
 * reaching the SDK through `lib/sdk/index.ts`'s `export * from './types'`)
 * keeps the identical surface. File-wins-over-directory resolution keeps
 * `./types` pointing here — the same precedent as `lib/api/schemas.ts` +
 * `lib/api/schemas/`.
 */
export * from './types/core';
export * from './types/webhooks';
export * from './types/resources-crm';
export * from './types/resources-sales';
export * from './types/resources-engagement';
export * from './types/operations';
