# UI/UX Bugs Status

## Navigation Links Fixed ✅
- [x] Contacts list items navigate to detail page
- [x] Tasks list items navigate to detail page (CLICK FIXED)
- [x] Tasks data table title links to detail (LINK FIXED)
- [x] Deals kanban title links to detail (LINK FIXED)
- [x] Deals data table title links to detail (LINK FIXED)
- [x] Companies data table already had links
- [x] Leads already had navigation
- [x] Ticket click navigation (WAS FIXED)

## Sidebar Redesign ✅
- [x] Primary 8 items always visible with shortcuts
- [x] Sales collapsed by default (5 items)
- [x] Tools collapsed by default (10 items)
- [x] Settings grouped (Account/Security/Configure)
- [x] Compact sizing, better spacing
- [x] Keyboard shortcut badges

## Bulk Actions on Contacts ✅
- [x] Bulk action bar now reflects selection in real time (per-row + select-all checkboxes added to `contacts-client.tsx` list view)
- [x] Bulk actions wired to real `/api/tenant/contacts/bulk` endpoint (Tag, Untag, Assign, Status, Export, Delete) — replaced N+1 individual DELETE loop
- [x] Selected rows highlighted; selection cleared after a successful bulk operation

## Not Yet Fixed
_None tracked at the moment._
