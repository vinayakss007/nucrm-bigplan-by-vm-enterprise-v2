# Import/Export Wizards Missing (Issue #471)

There is currently no user interface for bulk data import or export (CSV/XLSX), which acts as a barrier for onboarding new users or extracting reports.

## Issue Details
- As per Issue #471, the system forces users into manual data entry or requires developers to seed data through scripts.
- There is no self-serve Wizard to upload a CSV file and map columns to entity fields (e.g. Contacts, Leads).
- Similarly, a simple and generic export capability is missing from the table views.

## Recommendation
Build a generic Import Wizard component that handles CSV/XLSX parsing (using a library like `papaparse` or `xlsx`), provides a visual column-mapping step against the Drizzle schema, and processes the import either synchronously (if small) or via the background queue. Expose export functionality as a generic data-table action.
