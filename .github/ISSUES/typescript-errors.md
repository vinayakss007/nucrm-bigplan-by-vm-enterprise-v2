# TypeScript Compilation Errors

During a full run of `npm run check`, multiple TypeScript compilation errors were found across 10 different files.

## Summary of Errors
- `app/api/superadmin/selective-restore/scope/route.ts:93`: Object is possibly 'undefined'.
- `app/api/tenant/admin/ai-providers/route.ts:98`: Object is possibly 'undefined'.
- `app/api/tenant/admin/picklists/route.ts:113`: Type 'unknown' is not assignable to type 'PicklistEntry[]'.
- `app/api/tenant/contacts/import/route.ts:119`: Type 'string | undefined' is not assignable to type 'string | null'.
- `app/api/tenant/deals/import/route.ts`: Type 'string | undefined' is not assignable to type 'string | null' (multiple occurrences).
- `app/tenant/analytics/analytics-client.tsx:74,75`: Object is possibly 'undefined'.
- `app/tenant/reports/custom/page.tsx:346`: Object is possibly 'null' or 'undefined'. Operator '>' cannot be applied.
- `lib/ai/secrets.ts:373`: Object is possibly 'undefined'.
- `lib/queue/index.ts:153`: Type conversion may be a mistake.
- `lib/rate-limit.ts:113,121`: Type 'number | undefined' is not assignable to type 'number'.

These need to be fixed to ensure `npm run check` successfully passes.
