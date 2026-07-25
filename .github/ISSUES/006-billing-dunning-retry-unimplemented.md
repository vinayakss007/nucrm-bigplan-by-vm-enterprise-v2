# Billing Dunning Retry Background Job Unimplemented (Issue #601)

While reviewing the billing dunning implementation in `app/api/tenant/billing/dunning/retry/route.ts`, we discovered an unimplemented section.

## Issue Details
- The manual retry endpoint `POST /api/tenant/billing/dunning/retry` correctly validates the request, verifies Stripe configuration, and checks the retry limits.
- It inserts a `dunningAttempts` record.
- However, the actual background job to retry the payment via Stripe is missing.
- The code explicitly notes: `// TODO: In a real implementation, this would trigger a background job to retry the payment via Stripe. For now, we'll just record the attempt.`

This means that clicking "Retry Payment" only records a database row but doesn't actually hit the Stripe API to attempt a charge, leaving users stuck with failed payments.

## Recommendation
Implement the background job payload submission using the consolidated queue system (e.g. BullMQ) to properly trigger the Stripe payment retry logic asynchronously, or invoke the Stripe SDK directly if immediate feedback is preferred for manual retries.
