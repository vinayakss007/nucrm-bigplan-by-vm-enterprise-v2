# TODO — Testing & Bug Fixes (No New Features)

## Focus: Make the existing app solid, not add more

---

## TODAY (July 5, 2026)

### Must Do
- [ ] Merge **PR #296** (bug fix: email duplicate check + contact_id in GET)
- [ ] Browser test: Leads page — contact search, create lead with contact, create without
- [ ] Browser test: Lead detail page — verify linked contact shows
- [ ] Browser test: Contact page — verify leads list on contact detail
- [ ] Browser test: Dashboard — verify stats render correctly
- [ ] Browser test: Login/Logout — verify session works
- [ ] Browser test: Settings — verify CSRF token works on all forms

### Should Do
- [ ] Check all API endpoints return correct data (no missing fields)
- [ ] Check all forms handle validation errors gracefully
- [ ] Check all pages load without console errors
- [ ] Check responsive design on mobile widths

### Bugs to Hunt
- [ ] Any broken links or dead routes
- [ ] Any forms that don't submit
- [ ] Any pages that crash or show blank
- [ ] Any API endpoints that return 500
- [ ] Any missing error messages (user sees "Something went wrong")

---

## REPO STATUS
| PR | Title | Status |
|----|-------|--------|
| #294 | CSRF cookies + setup fix | ✅ Merged |
| #295 | Contact search & linking | ✅ Merged |
| #296 | Email duplicate check + contact_id fix | 🟡 Open — merge first |

## RULES
1. **No new features** — only fix bugs and test existing functionality
2. **Test in browser** — not just API calls
3. **If it's broken, fix it** — don't move on
4. **Document what you find** — notes in this file
