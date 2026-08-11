# Issue: Industry Templates Missing Lead-Intake Form Integration

## Description
According to `docs/planning/REMAINING_BUILD_PLAN.md` (Phase 5, gap 5.1), there is a documented tracking gap regarding industry templates.

The build plan states:
`5.1 Industry templates drive lead-intake forms — per-vertical field schema in lib/industry-templates/*, rendered in public form pages and the inline lead "Add" modal`

Currently, industry templates do not dynamically drive the schema and fields for lead-intake forms. The public form pages and the internal lead creation modals are missing the per-vertical field mapping.

## Location
- Documentation: `docs/planning/REMAINING_BUILD_PLAN.md`
- Target Code Areas: `lib/industry-templates/*`, public lead-capture forms, and the inline "Add Lead" modal component.

## Impact
Without this feature, the system cannot offer a vertical-specific CRM experience out-of-the-box (e.g., real estate vs. SaaS). Lead intake forms remain generic, forcing administrators to manually recreate industry-standard fields instead of automatically inheriting them from the tenant's chosen industry template.

## Expected Behavior
The codebase should be updated to implement logic in `lib/industry-templates/` that defines per-vertical lead intake schemas. This schema should be seamlessly parsed and rendered by both the public-facing form components and the internal "Add Lead" modal to provide an industry-specific data entry experience.
