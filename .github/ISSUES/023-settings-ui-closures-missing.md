# Issue: Settings UI Closures & Bulk Operations Incomplete

## Description
In `docs/planning/BULK_AND_SETTINGS_GAPS.md` and `docs/planning/REMAINING_BUILD_PLAN.md`, there are numerous settings UI closures and bulk features marked as `TODO` that are missing from the codebase.

The `BULK_AND_SETTINGS_GAPS.md` document explicitly lists the following unimplemented items:
- Bulk add to sequence / list / segment
- Bulk update custom field value
- Bulk note / activity
- Bulk merge for leads & companies
- Bulk email send + bulk SMS / WhatsApp
- Lead scoring rules editor UI
- Field permissions UI (table exists but UI is missing)
- Saved views & saved searches
- Sidebar pinned-shortcuts persistence (cookies → server-side per-user)
- Super-admin settings expansion (provider keys UI, white-label, maintenance mode)
- Tags manager backend execution (currently just a UI stub for renaming)

Additionally, the super-admin monitoring page expansion is marked as `TODO`.

## Location
- Documentation: `docs/planning/BULK_AND_SETTINGS_GAPS.md` (Sections 5, 9, 11.5)
- Affected UI areas: Tenant settings, Super Admin settings, Data Tables (bulk actions).

## Impact
Without these features, the application lacks critical enterprise CRM capabilities (like bulk operations and granular field permissions UI), leading to reduced productivity for users and administrators. The tags manager is only a stub, meaning operations like tag renaming across tables won't actually work in the backend.

## Expected Behavior
The missing UI components and corresponding API routes/backend execution logic should be implemented for each of the listed TODO items, ensuring full functionality as specified in the planning documentation.
