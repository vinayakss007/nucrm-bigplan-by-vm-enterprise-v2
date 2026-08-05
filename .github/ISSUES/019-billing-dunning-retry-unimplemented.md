# Issue: Unimplemented Background Job for Billing Dunning Retry

## Description
In `app/api/tenant/billing/dunning/retry/route.ts`, there is an incomplete implementation for manual payment retries for subscriptions. The API successfully creates a `dunningAttempts` record and records a `billingEvents` log, but it currently lacks the actual integration to trigger the background job via Stripe.

A `TODO` comment explicitly notes this missing behavior:
`// TODO: In a real implementation, this would trigger a background job to retry the payment via Stripe. For now, we'll just record the attempt.`

## Location
- File: `app/api/tenant/billing/dunning/retry/route.ts`
- Line: ~93

## Impact
Manual attempts to retry a failed payment via the dunning process will record the attempt in the database but won't actually process the retry with the payment gateway (Stripe). Subscriptions with payment failures will remain unpaid unless the customer manually updates their payment method on the Stripe end.

## Expected Behavior
When an admin invokes the dunning retry endpoint, the system should enqueue a background job (e.g., using Inngest, BullMQ, or PgBoss depending on the configured queue provider) to communicate with Stripe and attempt to capture the payment, subsequently updating the attempt status to `successful` or `failed`.
