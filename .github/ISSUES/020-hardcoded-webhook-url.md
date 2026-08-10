# Issue: Hardcoded Webhook URL in Integrations API

## Description
In `app/api/tenant/integrations/route.ts`, there is an issue documented in `TODO-tomorrow.md` regarding a hardcoded placeholder webhook URL. Although `grep` did not reveal the explicit string "webhook URL" inside the file currently, the project documentation explicitly lists this as a remaining low-priority bug.

`TODO-tomorrow.md` explicitly calls out:
- `app/api/tenant/integrations/route.ts` — hardcoded placeholder webhook URL (cosmetic)

## Location
- File: `app/api/tenant/integrations/route.ts`
- Related File: `TODO-tomorrow.md`

## Impact
While marked as cosmetic, having hardcoded placeholder values in API routes can cause confusion, unexpected behavior during testing or integration setup, and potentially leak development/testing URLs into production environments.

## Expected Behavior
The API route should either dynamically generate the webhook URL based on the environment (e.g., using `process.env.NEXT_PUBLIC_APP_URL` or a similar environment variable), or the field should be derived from the actual configuration/payload rather than being hardcoded to a placeholder string.
