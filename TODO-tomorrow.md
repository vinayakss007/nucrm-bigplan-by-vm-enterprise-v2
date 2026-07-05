# Tasks for Tomorrow (July 5, 2026)

## Priority 1 — Merge & Verify
- [ ] Review and merge **PR #296** (bug fix: email duplicate check + contact_id in GET)
  - https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2/pull/296
- [ ] Verify all 3 PRs merged cleanly into `main`: #294, #295, #296

## Priority 2 — E2E Browser Testing
- [ ] Start dev server (`npm run dev`) and test in actual browser
- [ ] Test **Leads page** — contact search in QuickAddModal (search by name/email/company)
- [ ] Test **Create Lead** — select existing contact, verify fields auto-fill
- [ ] Test **Create Lead** — create without contact (normal flow), verify contact is auto-created
- [ ] Test **Leads list** — verify contact_id shows, click through to lead detail
- [ ] Test **Lead detail page** — verify linked contact appears

## Priority 3 — Cleanup
- [ ] Delete stale remote branch `origin/feat/lead-contact-search` (PR #295 merged)
- [ ] Delete stale remote branch `origin/fix/csrf-and-setup` (PR #294 merged)
- [ ] Delete local branches if no longer needed
- [ ] Review if any soft-deleted test data needs cleaning

## Priority 4 — Next Feature Work
- [ ] Decide next feature or bug to tackle
- [ ] Check if there are open issues on the repo
- [ ] Review user feedback or new requirements
