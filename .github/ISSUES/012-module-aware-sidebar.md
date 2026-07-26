# Module-Aware Sidebar Navigation Missing (Issue #428)

The main sidebar navigation does not currently respect the tenant's installed modules, creating a confusing user experience.

## Issue Details
- Tenants can enable or disable specific modules (e.g., Sales, Support, KB) via `tenantModules` in their settings.
- However, the `Sidebar` component unconditionally renders all navigation links regardless of whether the tenant has actually installed those modules.
- Users clicking on uninstalled modules may encounter 404s, "Not Authorized" screens, or empty states that are irrelevant to their workspace setup.

## Recommendation
Update the main sidebar navigation logic to conditionally render items based on the tenant's active modules (`tenantModules`). Pass the installed modules array down to the sidebar component and filter the list of navigation groups accordingly.
