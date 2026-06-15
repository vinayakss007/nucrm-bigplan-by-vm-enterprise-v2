# NuCRM Page Redesign Plan — Leads, Contacts, Companies

## Current Problems Summary

| Problem | Leads | Contacts | Companies |
|---------|-------|----------|-----------|
| Delete without confirmation | Yes (detail page) | Partial | Uses confirmThen (good) |
| Tags visible on list | Partial (2 max) | Partial | Not shown |
| Text too small | text-xs labels, wasted space | Same | Same |
| Grid view | No | Yes | No |
| Kanban view | Yes | No | No |
| Inline status change | Yes | No | No |
| Inline editing | Status only | None | None |
| Bulk actions | Delete + Qualify only | Rich (tag/untag/assign/status/export/delete) | Rich (assign/tag/status/delete) |
| Export | No | Yes (CSV) | No |
| Import | Yes | Yes | No |
| Activity timeline | Placeholder buttons | Working | N/A (no client component) |
| Quick add (inline) | Modal | Modal | Inline form |
| Interactive detail page | Yes (client) | Yes (client) | No (server-only) |
| Duplicate constants | Yes | Yes | N/A |
| Filter by lifecycle | No | No | No |
| Last activity column | API missing field | Yes | No |
| API response format | Mixed case | camelCase | camelCase |

---

## Design Principles

### 1. Space Utilization (No Wasted Space)
- **Labels**: Use `text-sm font-semibold` instead of `text-xs font-extrabold uppercase tracking-wider`. Save uppercase for section headers only
- **Table cells**: Use `text-sm` for content, `text-xs` only for secondary/meta info
- **Card padding**: Reduce from `p-6` to `p-4`, use negative space better
- **Page width**: Remove max-width constraint or increase to 1920px, use full viewport
- **Row height**: Reduce padding from `py-3 px-4` to `py-2.5 px-3` to fit more data

### 2. Clear Boundaries (Visual Hierarchy)
- Each section has a clear top border or background tint
- Cards have `border-l-4` with accent color for visual anchoring
- Table rows have distinct hover state + alternating subtle bg
- Action buttons are visually grouped, not scattered
- Delete is always red + requires confirmation dialog

### 3. Delete Safety
- Every delete action (single or bulk) MUST use a confirmation dialog with entity name
- Detail page: delete is in a RED confirmation dialog, not just a dropdown item
- Bulk delete: same confirmation with count of items being deleted
- Soft delete by default (already implemented), with undo toast option

### 4. Quick Actions Visible
- Common actions (Call, Email, Edit, Status) are visible as icon buttons on every row
- Secondary actions (Delete, Share, etc.) stay in dropdown
- At least 4 primary actions visible without clicking "More"

### 5. Consistency Across Pages
- Same layout structure for all listing pages (header → KPI strip → toolbar → table → pagination)
- Same detail page layout (header with avatar → stats cards → sidebar+main tabs)
- Same API response format (all camelCase)
- Shared constants file instead of per-file duplication

---

## Files to Create/Modify

### New Files
1. `lib/constants.ts` — Centralized constants (PIPELINE_CONFIG, LIFECYCLE_STAGES, STATUS_CONFIG, AUTHORITY_LEVELS, SOURCE_LABELS)
2. `components/ui/detail-layout.tsx` — Reusable detail page layout (header + sidebar + main content + tabs)
3. `components/ui/activity-timeline.tsx` — Reusable activity timeline with quick-add
4. `components/tenant/companies-client.tsx` — New client component for companies listing (replaces server-only page)
5. `components/tenant/company-detail-client.tsx` — New interactive company detail page
6. `components/tenant/leads-client.tsx` — FULL REPLACEMENT of leads-client-new.tsx (redesign)
7. `components/tenant/lead-detail-client.tsx` — FULL REPLACEMENT (redesign)
8. `components/tenant/contacts-client.tsx` — FULL REPLACEMENT (redesign)
9. `components/tenant/contact-detail-client.tsx` — FULL REPLACEMENT (redesign)
10. `components/ui/confirm-delete.tsx` — Standardized delete confirmation dialog

### Modified Files
11. `app/tenant/companies/[id]/page.tsx` — Switch to client component wrapping
12. `app/tenant/leads/[id]/page.tsx` — Update data passing for new detail client
13. `app/tenant/contacts/[id]/page.tsx` — Update data passing for new detail client
14. `app/globals.css` — Add `text-sm` base, better table styles, boundary classes
15. `lib/utils.ts` — Add shared formatting helpers (score tier colors, etc.)

---

## Phase 1: Foundation (Shared Infrastructure)

### 1A. Centralized Constants (`lib/constants.ts`)

```typescript
// PIPELINE_CONFIG — single source of truth for pipeline stages
// LIFECYCLE_STAGES — visitor → lead → mql → sql → opportunity → customer → evangelist
// STATUS_CONFIG — new, contacted, qualified, unqualified, converted, lost, nurturing
// AUTHORITY_LEVELS — decision_maker, influencer, user, unknown
// SOURCE_LABELS — website, referral, cold_outreach, social_media, event, inbound, ad, other
// SCORE_TIERS — threshold > colors for score display
```

**What changes**: Removes ~40 lines of duplicated config from every component. Single import.

### 1B. Delete Confirmation Standard (`components/ui/confirm-delete.tsx`)

```tsx
// Standard delete dialog:
// - Red destructive button
// - Shows entity name + type
// - "Are you sure you want to delete {name}?" 
// - Optional: "Also delete related records" checkbox
// - Returns promise — await before proceeding
```

**What changes**: All delete operations go through this component. No inline confirmThen or direct delete.

### 1C. App Globals Update (`app/globals.css`)

Add utility classes:
```css
/* Card with left accent border */
.accent-card { @apply rounded-xl border border-border bg-card; }
.accent-card-primary { border-left: 4px solid hsl(var(--primary)); }

/* Better table spacing */
.table-compact td, .table-compact th { @apply px-3 py-2.5; }

/* Section boundary */
.section-divider { @apply border-t border-border/50 my-4; }

/* Text size base - slightly larger */
.text-base-sm { font-size: 0.8125rem; }  /* 13px instead of 12px for labels */
```

---

## Phase 2: Leads Redesign

### 2A. Leads Listing (`components/tenant/leads-client.tsx`)

**Layout** (full-width, max-width removed):
```
┌──────────────────────────────────────────────────────────┐
│ [Target icon] Leads [count badge]  [List|Grid|Board] [New Lead] │  ← Header
├──────────────────────────────────────────────────────────┤
│ [All] [New] [Contacted] [Qualified] [Disqualified] ...   │  ← KPI strip (pipeline stages with counts + progress bars)
├──────────────────────────────────────────────────────────┤
│ [🔍 Search...]  [Sort ▼] [Filters ▼]                     │  ← Toolbar (search + sort + filter)
├──────────────────────────────────────────────────────────┤
│ [Bulk bar: X selected | Tag | Assign | Qualify | Export | Delete] │  ← Bulk actions (shown when rows selected)
├──────────────────────────────────────────────────────────┤
│ ☐ │ LEAD │ COMPANY │ CONTACT │ STATUS │ SCORE │ BANT │ ACTIVITY │  ← Table headers (compact)
│ ☐ │ [Avatar] John Doe │ Acme Inc │ john@... │ [Status badge] │ ████ 75 │ $50k DM │ 2d ago │ [📞📧✏️⋮] │  ← Row with quick action icons
│ ☐ │ [Avatar] Jane Smith │ Beta Corp │ jane@... │ [Status badge] │ ████ 42 │ $20k │ 5d ago │ [📞📧✏️⋮] │
├──────────────────────────────────────────────────────────┤
│ Showing 1-50 of 234 leads                    [← Prev] [Next →] │  ← Pagination
└──────────────────────────────────────────────────────────┘
```

**Key changes from current:**
1. **Text size**: Labels `text-sm` not `text-xs`. Content `text-[15px]` not `text-sm`.
2. **Quick action icons**: Each row has visible Phone, Email, Edit icon buttons without needing hover
3. **Tags**: Show up to 5 tags on each row, with "+N more" overflow (was 2 max)
4. **Delete safety**: Delete is always in dropdown with `confirmDelete()` — red confirmation dialog shows entity name
5. **Grid view**: New grid card view for visual browsing (desktop only)
6. **Inline score edit**: Click score to quick-edit inline (small input popover)
7. **Last activity**: Fixed — `last_activity_at` column now fetched from API
8. **Filter by lifecycle**: New dropdown filter for lifecycle stage
9. **Export**: CSV export button in toolbar
10. **Bulk actions**: Added tag, assign, export to existing delete + qualify
11. **Filter button**: Functional on mobile — opens a slide-out filter panel
12. **Boundaries**: Each section (header, KPI, toolbar, table) has clear visual separation
13. **Edit button**: Not just in dropdown — has its own icon on row hover

### 2B. Leads Detail (`components/tenant/lead-detail-client.tsx`)

**Layout** (sidebar + main):
```
┌──────────────────────────────────────────────────────────────────────┐
│ [← Back] [Avatar] John Doe │ [Status ▼] [Edit] [📞] [📧] [More ⋮]   │  ← Header with visible quick actions
├──────────────────────────────────────────────────────────────────────┤
│ ┌─── SIDEBAR (w-72) ───┐ ┌─────────── MAIN CONTENT ────────────────┐│
│ │ Score: 75/100      ██│ │ [Overview] [Activity] [Notes] [Related]  ││  ← Tab bar
│ │ Status: Qualified      │ │ ┌─ Overview ──────────────────────────┐ ││
│ │ Budget: $50,000        │ │ │ Basic Info │ Company │ BANT │ Tags   │ ││  ← 2-column grid
│ │ Authority: Decision... │ │ │                                     │ ││
│ │ Timeline: 1-3 months   │ │ └─────────────────────────────────────┘ ││
│ │ Owner: Alice Smith     │ │ ┌─ Activity ──────────────────────────┐ ││
│ │ Source: Website        │ │ │ [Note] [Call] [Email] [Meeting]     │ ││  ← Quick-add tabs
│ │ Tags: [hot] [tech] ... │ │ │ ┌ Timeline ──────────────────────┐  │ ││
│ │ Created: Jan 15, 2026  │ │ │ │ • Called client — 2h ago       │  │ ││
│ └────────────────────────┘ │ │ │ • Sent proposal — 1d ago       │  │ ││
│                            │ │ │ • Email follow-up — 3d ago     │  │ ││
│                            │ │ └────────────────────────────────┘  │ ││
│                            │ └─────────────────────────────────────┘ ││
└──────────────────────────────────────────────────────────────────────┘
```

**Key changes from current:**
1. **Sidebar pattern**: Left sidebar shows key info at a glance (score, status, budget, authority, timeline, owner, source, tags, created date). Sticky on scroll.
2. **Quick action buttons**: Call, Email, Edit are **always visible** in header — not hidden in dropdown
3. **Delete safety**: Delete button is in the More dropdown, opens a RED confirmation dialog with lead name
4. **Activity tab**: COMPLETELY REWRITTEN. Quick-add composer (Note/Call/Email/Meeting tabs) actually works — posts to API. Timeline shows all activities chronologically.
5. **Notes tab**: Functional — inline text editor with save button
6. **Edit**: Opens an inline panel on the right, not a modal. Saves in place.
7. **Tags**: Click to add/remove tags inline with autocomplete from existing tags
8. **Boundaries**: Sidebar has border-right, tab content has clear card borders, sections separated by accent lines
9. **Text size**: Labels `text-sm`, values `text-[15px]`. Better readability.
10. **Conversion button**: Prominent "Convert to Contact/Deal" button at bottom of sidebar

### 2C. Leads API Fixes (`app/api/tenant/leads/route.ts`)

1. Add `lastActivityAt` to the SELECT query (currently missing)
2. Standardize response format: always return camelCase (remove manual snake_case mapping)
3. Add `lifecycle_stage` filter support

---

## Phase 3: Contacts Redesign

### 3A. Contacts Listing (`components/tenant/contacts-client.tsx`)

**Layout** — mirror Leads structure for consistency:
```
┌──────────────────────────────────────────────────────────┐
│ [Users icon] Contacts [count badge]  [List|Grid] [Import] [New] │
├──────────────────────────────────────────────────────────┤
│ [All] [New] [Contacted] [Qualified] [Disqualified] ...    │  ← Status filter pills
├──────────────────────────────────────────────────────────┤
│ [🔍 Search...]  [Lifecycle ▼] [Sort ▼]                   │
├──────────────────────────────────────────────────────────┤
│ [Bulk: Tag | Untag | Assign | Status | Export | Delete]  │
├──────────────────────────────────────────────────────────┤
│ ☐ │ CONTACT │ COMPANY │ EMAIL │ PHONE │ STATUS │ LIFECYCLE │ SCORE │ ADDED │ ACTIONS │
│ ☐ │ [Avatar] John D. │ Acme Inc │ j@... │ +1234 │ [Status] │ [MQL]  │ ██ 75 │ Jan 15 │ [📞📧✏️⋮]│
├──────────────────────────────────────────────────────────┤
│ Pagination                                               │
└──────────────────────────────────────────────────────────┘
```

**Key changes from current:**
1. **Mirror Leads layout**: Same KPI strip, toolbar, bulk actions, pagination pattern
2. **Phone column**: Visible in table (currently no dedicated phone column)
3. **Quick actions**: Phone, Email, Edit icons per row
4. **Inline status change**: Dropdown like leads (not just in detail page)
5. **Lifecycle badge**: Colored badge always visible in every row (was only in detail)
6. **Tags**: Show 3+ tags per row with overflow
7. **Kanban view**: Add Board view toggle (same as leads)
8. **Delete safety**: Through confirmDelete dialog
9. **Boundaries**: Clear section separation
10. **Text sizes**: Larger than current

### 3B. Contact Detail (`components/tenant/contact-detail-client.tsx`)

Same sidebar+main layout as Lead Detail:
- **Sidebar**: Avatar, name, company, email, phone, status, lifecycle, score, tags, owner, created date, source
- **Main tabs**: Overview (editable fields), Activity (timeline + quick-add), Tasks (with checkbox toggle), Deals (pipeline value), Billing, History
- **Delete safety**: RED confirmation dialog
- **Quick actions**: Call, Email, Edit always visible
- **Add task/deal/meeting**: Quick-add forms inline in sidebar

---

## Phase 4: Companies Redesign

### 4A. Companies Listing (`components/tenant/companies-client.tsx`)

Replace current `companies-data-table.tsx` with a full client component matching Leads/Contacts pattern.

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│ [Building2] Companies [count]  [Import] [New Company]    │
├──────────────────────────────────────────────────────────┤
│ [🔍 Search...]  [Industry ▼] [Sort ▼]                   │
├──────────────────────────────────────────────────────────┤
│ [Bulk: Assign Owner | Add Tag | Set Status | Delete]     │
├──────────────────────────────────────────────────────────┤
│ ☐ │ COMPANY │ INDUSTRY │ WEBSITE │ PHONE │ CONTACTS │ LOCATION │ ACTIONS │
│ ☐ │ [Avatar] Acme Inc │ Tech │ acme.com │ +1234 │    12  │ SF, USA │ [✏️⋮] │
├──────────────────────────────────────────────────────────┤
│ Pagination                                               │
└──────────────────────────────────────────────────────────┘
```

**Key changes from current:**
1. **Client component**: Was server-rendered via DataTable, now full interactive client
2. **Contact count column**: Shows number of contacts for each company
3. **Quick stats**: Header shows total companies, total contacts
4. **Industry filter**: Dropdown to filter by industry
5. **Import**: CSV import (same as leads/contacts pattern)
6. **Delete safety**: confirmDelete dialog with company name
7. **Consistent layout**: Same KPI/toolbar/table/pagination pattern as leads and contacts
8. **Text and space**: Better utilization, larger text

### 4B. Company Detail (`components/tenant/company-detail-client.tsx`)

**NEW** — Currently all server-rendered with no interactivity. Complete rewrite.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [← Back] [Avatar] Acme Inc │ [Status ▼] [Edit] [Add Contact] [More ⋮] │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─── SIDEBAR ─────────────┐ ┌────── MAIN CONTENT ──────────────────┐│
│ │ Website: acme.com        │ │ [Contacts] [Leads] [Deals] [Activity] ││
│ │ Phone: +1 (555) 123-4567 │ │ ┌─ Contacts ──────────────────────┐  ││
│ │ Industry: Technology     │ │ │ [Add Contact] [Import]          │  ││
│ │ Size: 50-200             │ │ │ ┌─ Contact list ──────────────┐ │  ││
│ │ Address: San Francisco   │ │ │ │ • John Doe — VP Sales      │ │  ││
│ │ Owner: Alice Smith       │ │ │ │ • Jane Smith — CTO         │ │  ││
│ │ Created: Jan 15, 2026    │ │ │ └────────────────────────────┘ │  ││
│ │ Tags: [partner] [saas]   │ │ └────────────────────────────────┘  ││
│ │                         │ │ ┌─ Activity ─────────────────────┐  ││
│ │ [Edit Company Info]     │ │ │ [Note] [Call] [Email]         │  ││
│ │                         │ │ │ ┌ Timeline ─────────────────┐ │  ││
│ └─────────────────────────┘ │ │ │ • Added contact — 1h ago │ │  ││
│                            │ │ └───────────────────────────┘ │  ││
│                            │ └────────────────────────────────┘  ││
└──────────────────────────────────────────────────────────────────────┘
```

**Key features:**
1. **Editable**: Click "Edit" to edit company fields inline
2. **Add Contact/Lead**: Quick-add forms in the tab content
3. **Activity timeline**: Log activity for the company
4. **Stats row**: Contact count, Lead count, Deal count, Pipeline value (as cards at top)
5. **Related entities**: Tabs for Contacts, Leads, Deals with inline lists + counts
6. **Delete safety**: RED confirmation dialog
7. **Tags**: Inline add/remove with autocomplete

### 4C. Company Detail API Fixes

1. Fix auth to use `requireTenantCtx()` instead of manual cookie verification
2. Replace raw SQL with Drizzle ORM for consistency
3. Add PATCH endpoint for inline editing
4. Add activity logging endpoint

---

## Phase 5: Cross-Cutting Fixes

### 5A. Standardize API Responses
- All entities return camelCase consistently (remove toSnakeCase/fromSnakeCase conversions)
- Add `lastActivityAt` to leads API
- Consistent error format: `{ error: string }` for errors, `{ data, total }` for lists

### 5B. Fix Bugs
- **Leads old client routes to contacts URLs**: Delete `leads-client.tsx` (old version), only keep `leads-client-new.tsx` (renamed to `leads-client.tsx`)
- **Leads filter button no-op**: Implement filter panel on mobile
- **Company detail auth**: Switch to `requireTenantCtx()`
- **Leads PATCH `status` vs `lead_status`**: Accept both, normalize internally

### 5C. Loading States
- Every page gets skeleton loading state matching final layout
- Table rows fade in with stagger animation
- Detail page shows skeleton sidebar + content area

### 5D. Responsive Design
- Desktop (>1024px): Full sidebar+main layout, table with all columns
- Tablet (768-1024px): Collapsed sidebar, fewer table columns
- Mobile (<768px): Card-based list, bottom sheet for filters, swipeable actions

---

## Implementation Order

1. **Phase 1A** — `lib/constants.ts`
2. **Phase 1B** — `components/ui/confirm-delete.tsx`
3. **Phase 1C** — `app/globals.css` additions
4. **Phase 5A** — API response standardization (across all 3 entities)
5. **Phase 5B** — Bug fixes (leads routing, company auth, etc.)
6. **Phase 2A+2B** — Leads full redesign (listing + detail)
7. **Phase 3A+3B** — Contacts full redesign (listing + detail)
8. **Phase 4A+4B+4C** — Companies full redesign (listing + detail + API)
9. **Phase 5C+5D** — Loading states + responsive polish

---

## Text/Boundary Rules (enforced in every component)

### Text Sizes
| Element | Before | After |
|---------|--------|-------|
| Page title | `text-xl font-bold` | `text-2xl font-bold` |
| Section headers | `text-xs extrabold uppercase tracking-wider` | `text-sm font-bold` |
| Labels (form) | `text-xs font-semibold` | `text-sm font-semibold` |
| Table cell content | `text-sm` | `text-[15px]` |
| Secondary/meta | `text-xs` | `text-sm text-muted-foreground` |
| Badge text | `text-xs` | `text-xs` (keep for badges) |
| KPI numbers | `text-xl` | `text-2xl` |
| KPI labels | `text-xs uppercase` | `text-sm font-semibold` |

### Boundaries
- **Section divider**: Every major section (header, stats, toolbar, table) is separated by `border-t` or `my-4`
- **Card groups**: Related cards are grouped in a container with border, individual cards inside don't have border
- **Action zones**: Primary actions in blue/violet zone, danger actions in red zone with gap separation
- **Tab bar**: Active tab has bottom border + accent color, inactive tabs are muted
- **Sidebar/main**: Left sidebar has `border-r`, right main content has no border

### Delete Safety Rules
1. Every delete button is RED or has red icon
2. Every delete action opens a confirmation dialog
3. Confirmation dialog shows: entity type icon + name + "Are you sure?"
4. Delete button in dialog is RED with "Delete {name}"
5. Dialog has a Cancel button alongside
6. Bulk delete same rules but shows count instead of individual names
7. Delete always soft-deletes (sets `deleted_at`), with undo option

### Visual Hierarchy
1. Page title → Section headers → Labels → Values
2. Cards with left accent border for primary data
3. KPI strip as most prominent visual element (top)
4. Data table as the main content area (middle)
5. Pagination as subtle footer (bottom)
6. Actions positioned at right, consistent across all rows
