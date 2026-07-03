# NuCRM — Full Manual Testing Checklist

**How to use:**
- Go through each section
- Mark `[ ]` as `[x]` when passed, `[F]` when failed
- For failures, write the bug in `docs/testing-bugs.md` with:
  - Page/route
  - What you did
  - What went wrong
  - Error message (if any)
  - Screenshot (if possible)

---

## 1. Authentication

### Login
- [ ] Login with valid email + password
- [ ] Login with wrong password → shows error
- [ ] Login with non-existent email → shows error
- [ ] Login redirects to `/tenant/dashboard`
- [ ] Session persists after page refresh
- [ ] Logout works → redirects to `/auth/login`
- [ ] CSRF token present on login form

### Signup
- [ ] Signup with valid data → creates account
- [ ] Signup with existing email → shows error
- [ ] Signup with weak password → shows error
- [ ] Email verification sent after signup

### Password Reset
- [ ] Forgot password page loads
- [ ] Submit valid email → sends reset link
- [ ] Reset link opens reset page
- [ ] Set new password → works
- [ ] Expired token → shows error

### 2FA / TOTP
- [ ] 2FA setup page loads
- [ ] QR code displays
- [ ] Verify with authenticator app → enables 2FA
- [ ] Login with 2FA → asks for code
- [ ] Wrong code → shows error
- [ ] Disable 2FA → works

### OAuth
- [ ] OAuth login page loads (if configured)
- [ ] OAuth callback works

### SSO
- [ ] SSO start page loads
- [ ] SSO callback works

---

## 2. Onboarding

- [ ] Onboarding page loads after first login
- [ ] Step 1: Company info → saves
- [ ] Step 2: Team setup → saves
- [ ] Step 3: Pipeline setup → saves
- [ ] Complete onboarding → redirects to dashboard
- [ ] Skip onboarding → works

---

## 3. Dashboard

- [ ] Dashboard loads without errors
- [ ] Stats cards show data (contacts, deals, revenue, tasks)
- [ ] Activity feed shows recent items
- [ ] Leads widget loads
- [ ] Tasks widget loads
- [ ] Invoices widget loads
- [ ] Follow-ups widget loads
- [ ] Contacts widget loads
- [ ] Dashboard layout is editable
- [ ] Widget refresh works

---

## 4. Contacts

### List View
- [ ] Contacts page loads
- [ ] Contact list displays
- [ ] Search contacts works
- [ ] Filter by tags works
- [ ] Filter by lifecycle stage works
- [ ] Filter by lead status works
- [ ] Sort by name/date works
- [ ] Pagination works
- [ ] Saved views work

### Create Contact
- [ ] Create contact form loads
- [ ] Submit with required fields → creates contact
- [ ] Submit with all fields → saves correctly
- [ ] Duplicate email detection (if enabled)
- [ ] Custom fields save correctly
- [ ] Tags can be added

### Edit Contact
- [ ] Edit contact form loads
- [ ] Update fields → saves
- [ ] Cancel → discards changes

### Contact Detail
- [ ] Contact detail page loads
- [ ] All tabs load (overview, activity, deals, tasks, notes, files)
- [ ] Activity timeline shows
- [ ] Notes can be added
- [ ] Files can be attached
- [ ] Related deals show
- [ ] Related tasks show

### Contact Actions
- [ ] Delete contact → works
- [ ] Archive contact → works
- [ ] Merge contacts → works
- [ ] Export contacts → downloads file
- [ ] Import contacts → uploads and creates
- [ ] Bulk edit contacts → works
- [ ] Bulk delete contacts → works

### Contact Lifecycle
- [ ] Change lifecycle stage → works
- [ ] Lifecycle history shows changes

### Contact Status
- [ ] Update lead status → works
- [ ] Mark as customer → works
- [ ] Do not contact → works

---

## 5. Companies

### List View
- [ ] Companies page loads
- [ ] Company list displays
- [ ] Search works
- [ ] Filter works
- [ ] Pagination works

### Create Company
- [ ] Create company form loads
- [ ] Submit with required fields → creates
- [ ] Submit with all fields → saves

### Edit Company
- [ ] Edit form loads
- [ ] Update → saves

### Company Detail
- [ ] Company detail page loads
- [ ] Associated contacts show
- [ ] Associated deals show
- [ ] Notes can be added
- [ ] Files can be attached

### Company Actions
- [ ] Delete company → works
- [ ] Bulk edit → works

---

## 6. Deals

### Pipeline View
- [ ] Pipeline page loads
- [ ] Deal cards display in stages
- [ ] Drag deal to next stage → works
- [ ] Deal count per stage shows
- [ ] Total value per stage shows

### Deal List
- [ ] Deal list view loads
- [ ] Search works
- [ ] Filter by stage works
- [ ] Filter by assigned works
- [ ] Filter by amount works
- [ ] Sort works
- [ ] Pagination works

### Create Deal
- [ ] Create deal form loads
- [ ] Select pipeline → stages update
- [ ] Submit with required fields → creates
- [ ] Assign to contact → links
- [ ] Assign to company → links
- [ ] Set amount → saves
- [ ] Set close date → saves
- [ ] Custom fields save

### Edit Deal
- [ ] Edit form loads
- [ ] Update → saves

### Deal Detail
- [ ] Deal detail page loads
- [ ] Contact info shows
- [ ] Company info shows
- [ ] Activity timeline shows
- [ ] Notes can be added
- [ ] Files can be attached
- [ ] Deal products show

### Deal Actions
- [ ] Delete deal → works
- [ ] Win deal → moves to won
- [ ] Lose deal → moves to lost
- [ ] Bulk edit → works

### Deal Forecast
- [ ] Forecast data shows (if enabled)
- [ ] Win probability shows

---

## 7. Leads

### List View
- [ ] Leads page loads
- [ ] Lead list displays
- [ ] Search works
- [ ] Filter by status works
- [ ] Filter by score works
- [ ] Filter by source works
- [ ] Sort works
- [ ] Pagination works

### Create Lead
- [ ] Create lead form loads
- [ ] Submit with required fields → creates
- [ ] All fields save correctly

### Edit Lead
- [ ] Edit form loads
- [ ] Update → saves

### Lead Detail
- [ ] Lead detail page loads
- [ ] Activity timeline shows
- [ ] Notes can be added

### Lead Actions
- [ ] Delete lead → works
- [ ] Convert lead → creates contact/deal
- [ ] Assign lead → works
- [ ] Import leads → uploads
- [ ] Bulk edit → works
- [ ] Lead history shows

### Lead Scoring
- [ ] Lead score displays
- [ ] Recompute scores → works (admin)

---

## 8. Tasks

### List View
- [ ] Tasks page loads
- [ ] Task list displays
- [ ] Search works
- [ ] Filter by status works
- [ ] Filter by assignee works
- [ ] Filter by due date works
- [ ] Sort works
- [ ] Pagination works

### Create Task
- [ ] Create task form loads
- [ ] Submit with required fields → creates
- [ ] Assign to contact → links
- [ ] Assign to deal → links
- [ ] Set due date → saves
- [ ] Set priority → saves

### Edit Task
- [ ] Edit form loads
- [ ] Update → saves

### Task Actions
- [ ] Complete task → works
- [ ] Delete task → works
- [ ] Bulk complete → works
- [ ] Bulk delete → works

---

## 9. Activities

### List View
- [ ] Activities page loads
- [ ] Activity list displays
- [ ] Search works
- [ ] Filter by type works
- [ ] Filter by date works

### Create Activity
- [ ] Log call → works
- [ ] Log email → works
- [ ] Log meeting → works
- [ ] Log note → works
- [ ] Custom activity type → works

### Activity Detail
- [ ] Activity detail shows
- [ ] Edit activity → works
- [ ] Delete activity → works

---

## 10. Notes

- [ ] Add note to contact → works
- [ ] Add note to deal → works
- [ ] Add note to company → works
- [ ] Edit note → works
- [ ] Delete note → works
- [ ] Notes list shows chronological

---

## 11. Products

### List View
- [ ] Products page loads
- [ ] Product list displays
- [ ] Search works

### Create Product
- [ ] Create product form loads
- [ ] Submit → creates
- [ ] Set price → saves
- [ ] Set SKU → saves

### Edit Product
- [ ] Edit form loads
- [ ] Update → saves

### Product Actions
- [ ] Delete product → works

---

## 12. Quotes

### List View
- [ ] Quotes page loads
- [ ] Quote list displays
- [ ] Search works
- [ ] Filter by status works

### Create Quote
- [ ] Create quote form loads
- [ ] Add line items → works
- [ ] Select products → populates
- [ ] Set discount → calculates
- [ ] Set tax → calculates
- [ ] Submit → creates

### Edit Quote
- [ ] Edit form loads
- [ ] Update line items → saves
- [ ] Update totals → recalculates

### Quote Actions
- [ ] Send quote → works
- [ ] Accept quote → works
- [ ] Decline quote → works
- [ ] Cancel quote → works
- [ ] Delete quote → works

---

## 13. Invoices

### List View
- [ ] Invoices page loads
- [ ] Invoice list displays
- [ ] Search works
- [ ] Filter by status works

### Create Invoice
- [ ] Create invoice form loads
- [ ] Add line items → works
- [ ] Submit → creates

### Invoice Actions
- [ ] Send invoice → works
- [ ] Mark as paid → works
- [ ] Delete invoice → works

---

## 14. Pipelines

### List View
- [ ] Pipelines page loads
- [ ] Pipeline list displays

### Create Pipeline
- [ ] Create pipeline form loads
- [ ] Add stages → works
- [ ] Reorder stages → works
- [ ] Submit → creates

### Edit Pipeline
- [ ] Edit form loads
- [ ] Update stages → saves
- [ ] Rename pipeline → saves

### Pipeline Actions
- [ ] Delete pipeline → works
- [ ] Set default pipeline → works

---

## 15. Forms

### List View
- [ ] Forms page loads
- [ ] Form list displays

### Create Form
- [ ] Create form builder loads
- [ ] Add fields → works
- [ ] Reorder fields → works
- [ ] Set required fields → works
- [ ] Preview form → works
- [ ] Submit → creates

### Edit Form
- [ ] Edit form loads
- [ ] Update fields → saves

### Form Actions
- [ ] Publish form → works
- [ ] Unpublish form → works
- [ ] Delete form → works
- [ ] Embed code shows

### Form Submissions
- [ ] Public form loads
- [ ] Submit form → creates submission
- [ ] Submissions list shows
- [ ] Submission detail shows

---

## 16. Tickets

### List View
- [ ] Tickets page loads
- [ ] Ticket list displays
- [ ] Search works
- [ ] Filter by status works
- [ ] Filter by priority works

### Create Ticket
- [ ] Create ticket form loads
- [ ] Submit → creates

### Edit Ticket
- [ ] Edit form loads
- [ ] Update → saves

### Ticket Detail
- [ ] Ticket detail page loads
- [ ] Replies show
- [ ] Add reply → works
- [ ] Change status → works
- [ ] Change priority → works

### Ticket Actions
- [ ] Close ticket → works
- [ ] Reopen ticket → works
- [ ] Delete ticket → works

---

## 17. Documents

### List View
- [ ] Documents page loads
- [ ] Document list displays
- [ ] Search works

### Upload Document
- [ ] Upload document → works
- [ ] File appears in list
- [ ] File preview shows (if supported)

### Document Actions
- [ ] Download document → works
- [ ] Delete document → works

---

## 18. Meetings

### List View
- [ ] Meetings page loads
- [ ] Meeting list displays

### Create Meeting
- [ ] Create meeting form loads
- [ ] Link to contact → works
- [ ] Link to deal → works
- [ ] Set time/date → saves
- [ ] Submit → creates

### Edit Meeting
- [ ] Edit form loads
- [ ] Update → saves

### Meeting Actions
- [ ] Cancel meeting → works
- [ ] Delete meeting → works

---

## 19. Reports & Analytics

### Reports
- [ ] Reports page loads
- [ ] Report list displays
- [ ] Create custom report → works
- [ ] Run report → shows results
- [ ] Export report → downloads
- [ ] Schedule report → works

### Analytics
- [ ] Analytics page loads
- [ ] Churn analytics shows
- [ ] Forecast analytics shows
- [ ] Advanced analytics loads
- [ ] Stats overview shows

### Leaderboards
- [ ] Leaderboards page loads
- [ ] Rankings display

---

## 20. Automations & Workflows

### Automations
- [ ] Automations page loads
- [ ] Automation list displays
- [ ] Create automation → works
- [ ] Set trigger → saves
- [ ] Set conditions → saves
- [ ] Set actions → saves
- [ ] Activate automation → works
- [ ] Deactivate automation → works
- [ ] Delete automation → works

### Workflows (Visual Builder)
- [ ] Workflow builder loads
- [ ] Add nodes → works
- [ ] Connect nodes → works
- [ ] Configure nodes → saves
- [ ] Save workflow → works
- [ ] Run workflow → executes
- [ ] Workflow execution log shows

---

## 21. Webhooks

### List View
- [ ] Webhooks page loads
- [ ] Webhook list displays

### Create Webhook
- [ ] Create webhook form loads
- [ ] Set URL → saves
- [ ] Set events → saves
- [ ] Set headers → saves
- [ ] Submit → creates

### Edit Webhook
- [ ] Edit form loads
- [ ] Update → saves

### Webhook Actions
- [ ] Test webhook → sends test
- [ ] Activate webhook → works
- [ ] Deactivate webhook → works
- [ ] Delete webhook → works

### Webhook Logs
- [ ] Delivery logs show
- [ ] Retry failed delivery → works
- [ ] DLQ (Dead Letter Queue) shows
- [ ] Retry from DLQ → works
- [ ] Purge old DLQ entries → works

---

## 22. Email

- [ ] Send email from contact → works
- [ ] Send email from deal → works
- [ ] Email templates list loads
- [ ] Create email template → works
- [ ] Use template → populates
- [ ] Email tracking works (open/click)
- [ ] Bulk email → works
- [ ] Test email → works

---

## 23. SMS

- [ ] SMS page loads
- [ ] Send SMS → works
- [ ] SMS templates list
- [ ] SMS webhook processes

---

## 24. WhatsApp

- [ ] WhatsApp page loads
- [ ] Send WhatsApp message → works
- [ ] WhatsApp templates list

---

## 25. Integrations

### List View
- [ ] Integrations page loads
- [ ] Integration list displays

### Telegram
- [ ] Telegram integration page loads
- [ ] Configure bot token → saves
- [ ] Test Telegram bot → responds
- [ ] Telegram commands work (/search, /contacts, /deals, /tasks)

### Other Integrations
- [ ] Integration detail pages load
- [ ] Connect integration → works
- [ ] Disconnect integration → works

---

## 26. Settings

### General
- [ ] Settings page loads
- [ ] Update company name → saves
- [ ] Update branding → saves
- [ ] Update logo → saves
- [ ] Update favicon → saves
- [ ] Update primary color → saves

### Members / Team
- [ ] Members page loads
- [ ] Member list displays
- [ ] Invite member → sends invite
- [ ] Remove member → works
- [ ] Change member role → works

### Roles & Permissions
- [ ] Roles page loads
- [ ] Role list displays
- [ ] Create role → works
- [ ] Edit role permissions → saves
- [ ] Assign role to member → works
- [ ] Delete role → works

### Custom Fields
- [ ] Custom fields page loads
- [ ] Create custom field → works
- [ ] Edit custom field → works
- [ ] Delete custom field → works
- [ ] Custom field appears in forms

### Tags
- [ ] Tags page loads
- [ ] Create tag → works
- [ ] Edit tag → works
- [ ] Delete tag → works
- [ ] Assign tag to contact → works

### Picklists
- [ ] Picklists page loads
- [ ] Edit picklist values → saves

### Notifications
- [ ] Notification preferences page loads
- [ ] Update preferences → saves
- [ ] Notifications list shows
- [ ] Mark as read → works
- [ ] Mark all as read → works

### API Keys
- [ ] API keys page loads
- [ ] Create API key → works
- [ ] API key list shows
- [ ] Revoke API key → works
- [ ] API key usage shows

### Localization
- [ ] Localization settings loads
- [ ] Update timezone → saves
- [ ] Update locale → saves

### Security
- [ ] IP whitelist page loads
- [ ] Add IP → works
- [ ] Remove IP → works

### Login Policy
- [ ] Login policy page loads
- [ ] Update settings → saves

### SSO
- [ ] SSO settings page loads
- [ ] Configure SSO provider → works

---

## 27. Billing

- [ ] Billing page loads
- [ ] Current plan shows
- [ ] Plan details display
- [ ] Upgrade plan → works
- [ ] Invoice list shows
- [ ] Invoice detail shows
- [ ] Billing portal opens

---

## 28. Superadmin (if accessible)

### Dashboard
- [ ] Superadmin dashboard loads
- [ ] Tenant list shows
- [ ] System stats show

### Tenants
- [ ] Tenant list page loads
- [ ] Tenant detail page loads
- [ ] Create tenant → works
- [ ] Edit tenant → works
- [ ] Suspend tenant → works
- [ ] Delete tenant → works

### Plans
- [ ] Plans page loads
- [ ] Create plan → works
- [ ] Edit plan → works
- [ ] Delete plan → works

### Announcements
- [ ] Announcements page loads
- [ ] Create announcement → works
- [ ] Edit announcement → works

### Feature Registry
- [ ] Feature registry page loads
- [ ] Toggle feature → works

### Audit Logs
- [ ] Audit log page loads
- [ ] Log entries show
- [ ] Filter works
- [ ] Search works

---

## 29. Search

- [ ] Global search works
- [ ] Search contacts → results show
- [ ] Search companies → results show
- [ ] Search deals → results show
- [ ] Search leads → results show
- [ ] Search tasks → results show

---

## 30. Views (Saved Views)

- [ ] Saved views page loads
- [ ] Create saved view → works
- [ ] Apply view → filters apply
- [ ] Edit view → saves
- [ ] Delete view → works
- [ ] Default view works
- [ ] Shared view works

---

## 31. Segments

- [ ] Segments page loads
- [ ] Create segment → works
- [ ] Segment members show
- [ ] Edit segment → saves
- [ ] Delete segment → works

---

## 32. Sequences

- [ ] Sequences page loads
- [ ] Create sequence → works
- [ ] Add steps → works
- [ ] Activate sequence → works
- [ ] Enroll contact → works
- [ ] Sequence status shows

---

## 33. Projects (if enabled)

- [ ] Projects page loads
- [ ] Create project → works
- [ ] Add milestones → works
- [ ] Add tasks → works
- [ ] Project detail loads

---

## 34. Contracts (if enabled)

- [ ] Contracts page loads
- [ ] Create contract → works
- [ ] Edit contract → saves
- [ ] Delete contract → works

---

## 35. Services (if enabled)

- [ ] Services page loads
- [ ] Create service → works
- [ ] Edit service → saves
- [ ] Delete service → works

---

## 36. KB (Knowledge Base)

- [ ] KB page loads
- [ ] Article list shows
- [ ] Create article → works
- [ ] Edit article → saves
- [ ] Delete article → works
- [ ] Categories list shows
- [ ] Create category → works

---

## 37. Hierarchy

- [ ] Hierarchy page loads
- [ ] Org chart shows
- [ ] Edit hierarchy → saves

---

## 38. Trash

- [ ] Trash page loads
- [ ] Deleted items show
- [ ] Restore item → works
- [ ] Permanent delete → works
- [ ] Purge old items → works

---

## 39. Compliance

### GDPR
- [ ] GDPR page loads
- [ ] Data export → works
- [ ] Data deletion → works
- [ ] Consent tracking shows

### SOC2
- [ ] SOC2 page loads
- [ ] Compliance status shows

### Retention
- [ ] Retention settings page loads
- [ ] Update settings → saves

---

## 40. Backup

- [ ] Backup page loads
- [ ] Create backup → works
- [ ] Backup list shows
- [ ] Restore backup → works
- [ ] Backup config page loads
- [ ] Update backup settings → saves

---

## 41. Portal (Client Portal)

- [ ] Portal config page loads
- [ ] Portal login works
- [ ] Portal clients list shows
- [ ] Client can view their data

---

## 42. Embed

- [ ] Embed code page loads
- [ ] Widget embed code shows
- [ ] Chat widget loads on external page

---

## 43. Cron Jobs

- [ ] Cron endpoints respond (/api/cron/*)
- [ ] Keepalive endpoint works

---

## 44. Mobile / Responsive

- [ ] Dashboard looks good on mobile
- [ ] Contact list looks good on mobile
- [ ] Deal pipeline looks good on mobile
- [ ] Forms look good on mobile
- [ ] Navigation works on mobile

---

## 45. Performance

- [ ] Dashboard loads in < 3 seconds
- [ ] Contact list loads in < 2 seconds
- [ ] Deal pipeline loads in < 2 seconds
- [ ] Search results return quickly
- [ ] No memory leaks on long sessions

---

## 46. Edge Cases

- [ ] Empty states show helpful messages
- [ ] Long text doesn't break layout
- [ ] Special characters in names work
- [ ] Unicode/emoji in notes work
- [ ] Large file uploads work (within limits)
- [ ] Concurrent edits don't corrupt data
- [ ] Browser back/forward works correctly
- [ ] Page refresh maintains state
- [ ] Logout clears all data
- [ ] Session expiry shows login page

---

## Notes

Write bugs here as you find them:

```
### Bug: [Short description]
- **Page:** /tenant/...
- **What I did:** ...
- **What went wrong:** ...
- **Expected:** ...
- **Error:** ...
- **Screenshot:** (if available)
```
