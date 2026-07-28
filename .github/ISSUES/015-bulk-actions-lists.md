# Missing Bulk Actions on List Pages (Issue #465 & #482)

During review, it was noted that robust bulk action functionality is missing from entity list pages.

## Issue Details
- Issue #465 highlights that fundamental bulk actions (such as bulk delete, bulk assign, or bulk status change) are missing on core CRM list pages (like Contacts, Deals, Leads).
- Issue #482 notes the lack of a "select all matching" feature, meaning users can only operate on items currently visible on the active page, making it tedious to manage large datasets.

## Recommendation
Implement a unified bulk-action bar component. It should allow selecting multiple rows and present contextual actions (e.g. bulk update status, bulk delete, bulk assign). For large lists, support a "Select all X matching items across all pages" toggle that passes a query filter context to the bulk action API instead of a strict array of IDs.
