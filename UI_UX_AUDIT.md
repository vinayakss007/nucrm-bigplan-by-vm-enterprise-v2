# NuCRM UI/UX Audit — Full Page Analysis

## Global Foundation

### CSS Custom Properties (globals.css)
| Token | Current Value | Issue | Recommended |
|-------|--------------|-------|-------------|
| `--foreground` (light) | `0 0% 0%` (black) | OK | Keep |
| `--foreground` (dark) | `0 0% 100%` (white) | OK | Keep |
| `--muted-foreground` (light) | `215 10% 30%` | Still too light for subtext | `215 10% 20%` |
| `--muted-foreground` (dark) | `215 14% 80%` | Better | `215 14% 85%` |
| `--background` (light) | `220 14% 96%` | OK | Keep |
| `--background` (dark) | `222 24% 8%` | OK | Keep |
| `--card` (light) | `220 13% 99%` | Useful | Keep |
| `--card` (dark) | `222 20% 11%` | Dark enough | Keep |
| `--border` (light) | `220 11% 86%` | Subtle | Keep |
| `--border` (dark) | `222 16% 18%` | OK | Keep |

### Base Typography (globals.css)
| Element | Current | Issue | Recommended |
|---------|---------|-------|-------------|
| `html` | `font-size: 118.75%` (19px) | OK | `125%` (20px) |
| `body` | `font-weight: 500` | OK | `font-weight: 500` |
| `p, span, div, li, td, th` | `font-weight: 500` | OK | Keep |
| `h1` | `2.5rem font-extrabold` (40px) | Good | Keep |
| `h2` | `2rem font-extrabold` (32px) | Good | Keep |
| `h3` | `1.5rem font-bold` (24px) | Good | Keep |
| `h4` | `1.25rem font-bold` (20px) | Good | Keep |
| `h5` | `1.125rem font-bold` (18px) | Good | Keep |

---

## 1. Sidebar (TenantSidebar)

### Sidebar Container (`components/tenant/layout/sidebar.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Width | `w-[14.375rem]` (230px) | OK | Keep or `w-60` (240px) |
| Background | `tenant-sidebar` → `bg-card` | OK | Keep |
| Border | `border-r border-border` | Subtle | Keep |

### Sidebar Header (Brand area)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Height | `h-12` | OK | Keep |
| Workspace name | `text-base font-bold` | Too small | `text-lg font-extrabold` |
| Icon | `w-7 h-7` | Slightly small | `w-8 h-8` |

### Section Headers (Work, Sales, Support, etc.)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Font size | `text-sm` (14px) | Small | `text-base` (16px) |
| Font weight | `font-extrabold uppercase` | OK | Keep |
| Color (default) | `text-foreground/80` | Good | Keep |
| Color (hover) | `hover:text-foreground` | OK | Keep |
| Padding | `px-2.5 py-1.5` | OK | Keep |
| Text tracking | `tracking-wider` | OK | `tracking-wide` (less spread) |

### Nav Items (Dashboard, Contacts, Deals, etc.)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Font size | `text-sm` (14px) | Small | `text-[15px]` (15px) |
| Font weight | `font-bold` | OK | `font-extrabold` |
| Color (default) | `text-foreground` | OK | Keep |
| Color (hover) | `hover:text-foreground` | OK | Keep |
| Hover effect | `hover:scale-[1.02]` | Subtle | `hover:scale-[1.03]` |
| Padding | `px-2.5 py-1.5` | Compact | Keep |
| Icon size | `w-[1.125rem] h-[1.125rem]` | OK | `w-5 h-5` |
| Active bg | `bg-violet-50 dark:bg-violet-950/40` | OK | Keep |
| Active text | `text-violet-700 dark:text-violet-300` | OK | Keep |

### Section Item Count Badges
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Font size | `text-xs` (12px) | Small | `text-sm` (14px) |
| Color | `text-foreground/60` | 60% opacity | `text-foreground/80` |

### Filter Input
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Font size | `text-sm` (14px) | OK | Keep |
| Height | `py-1.5` | Compact | `py-2` |
| Search icon | `w-3.5 h-3.5` | Small | `w-4 h-4` |

### Pinned Section
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Label | `text-[0.625rem]` (10px) | Too small | `text-xs` (12px) |

### Settings Section
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Header button | `text-sm font-bold` | OK | Keep |
| Settings items | `text-sm font-bold` | OK | Keep |
| "All settings" link | `text-sm font-bold` | OK | Keep |

### Footer
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Quick search text | `text-xs text-foreground/70` | Small | `text-sm text-foreground/80` |
| Super Admin link | `text-sm font-semibold` | OK | `text-sm font-bold` |

### Collapsed Sidebar Mode
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Width | `w-[3.25rem]` | OK | Keep |
| Icon default color | `text-foreground/80` | Good | Keep |
| Icon hover | `hover:scale-110` | OK | Keep |

---

## 2. Main Content Layout

### TenantShell (`components/tenant/layout/shell.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Main area padding | `p-3 sm:p-4` | Compact | `p-4 sm:p-5` |
| Background | `bg-background` | OK | Keep |

### SuperAdminShell (`components/superadmin/shell.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Main area padding | `p-3 sm:p-4` | Compact | `p-4 sm:p-5` |
| Background | `bg-gray-950` | OK | Keep |

---

## 3. Dashboard Page (`components/tenant/dashboard-client.tsx`)

### Page Header
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Title | `text-2xl font-extrabold` | Good | Keep |
| Plan subtitle | `text-sm font-semibold text-foreground/70` | OK | Keep |

### Stat Cards (KPI Row)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Grid | `grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-6 gap-3` | OK | `gap-3` |
| Card container | `admin-card` (p-3) | Good | Keep |
| Label | `text-sm font-bold text-foreground/90` | OK | Keep |
| Value | `text-3xl font-extrabold` | Good | `text-4xl font-black` |
| Sub text | `text-sm font-medium text-foreground/70` | OK | Keep |
| Icon container | `w-7 h-7` | OK | `w-8 h-8` |
| Card hover | `hover:bg-accent/20` | Subtle | Keep |

### Activity Feed Card
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Header | `text-sm font-bold` | OK | Keep |
| Activity text | `text-sm font-medium` | OK | Keep |
| Activity time | `text-xs font-semibold text-foreground/60` | OK | Keep |
| Row padding | `px-3 py-2` | Compact | Keep |

### Tasks Card
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Header | `text-sm font-bold` | OK | Keep |
| Task title | `text-sm font-medium` | OK | `text-sm font-bold` |
| Due date | `text-xs font-bold` | OK | Keep |
| Row padding | `px-3 py-2` | Compact | Keep |

### Closing Soon Card
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Deal title | `text-sm font-bold` | OK | Keep |
| Deal value | `text-sm font-extrabold` | OK | `text-base font-black` |
| Stage badge | `text-xs font-semibold` | OK | Keep |
| Row padding | `px-3 py-2` | Compact | Keep |

### Recent Contacts Card
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Contact name | `text-sm font-bold` | OK | Keep |
| Contact email | `text-xs font-semibold text-foreground/70` | OK | Keep |
| Status badge | `text-xs font-bold` | OK | Keep |
| Avatar | `w-8 h-8` | OK | Keep |
| Row padding | `px-3 py-2` | Compact | Keep |

---

## 4. Data Tables

### Table Primitives (`components/ui/table.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Table font | `text-sm` (14px) | Small | Keep (base 19px = ~16.6px rendered) |
| TableHead height | `h-10` | OK | Keep |
| TableHead padding | `px-3` | Compact | `px-3` |
| TableHead color | `font-bold text-foreground/80` | Good | `font-extrabold text-foreground` |
| TableCell padding | `p-3` | Compact | Keep |
| Row hover | `hover:bg-muted/50` | Subtle | `hover:bg-accent/30` |

### Primary DataTable (`components/ui/data-table.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Toolbar height | Default | OK | Keep |
| Search input | `text-sm` | OK | Keep |
| Pagination buttons | `h-8 w-8` | Compact | Keep |
| Rows per page | `text-sm` | OK | Keep |

### Contacts Data Table (`components/tenant/contacts-data-table.tsx`)
(tanstack-based, uses primitives above)

### Deals Data Table (`components/tenant/deals-data-table.tsx`)
(tanstack-based, uses primitives above)

### Custom Contacts Table (`components/tenant/contacts-client.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Table header | `text-[10px] font-bold uppercase` | Very small | `text-xs font-extrabold uppercase` |
| Table cells | `text-sm` | OK | Keep |
| Row padding | `px-4 py-3` | OK | Keep |
| Badges | `text-[10px]` | Very small | `text-xs font-bold` |

---

## 5. Cards & Containers

### admin-card (`globals.css`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Background | `bg-card` | OK | Keep |
| Border | `none` | Removed | OK without borders |
| Border radius | `rounded-lg` | OK | Keep |
| Padding | `p-3` | Compact | Keep |
| Hover | `hover:shadow-sm` | Subtle | `hover:shadow-md` |
| Mobile | `p-2` | Tight | Keep |

---

## 6. Badges & Status Indicators

### Badge Component (`components/ui/badge.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Font size | `text-xs font-semibold` | OK | `text-sm font-bold` |
| Padding | Default | OK | Keep |

### Stage Badges (Dashboard/Deals)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Font size | `text-xs` | OK | Keep |
| Padding | `px-1.5 py-0.5` | OK | `px-2 py-0.5` |

---

## 7. Header / Top Navigation

### TenantHeader (`components/tenant/layout/header.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Breadcrumb | Variable | OK | Keep |
| Search/Command | Default | OK | Keep |
| Profile menu | Default | OK | Keep |

### SuperAdminHeader (`components/superadmin/header.tsx`)
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Layout | Default | OK | Keep |

---

## 8. Specific Page Issues

### Contacts Page
| Issue | Location | Recommended Fix |
|-------|----------|----------------|
| Table header too small | contacts-client.tsx | Change `text-[10px]` → `text-xs font-extrabold` |
| Badge text too small | contacts-client.tsx | Change `text-[10px]`/`text-[9px]` → `text-xs font-bold` |
| Form input labels tiny | contacts-client.tsx | Change `text-xs` → `text-sm font-bold` |
| Grid view item padding | contacts-client.tsx | Reduce from large padding to `p-3` |

### Deals Page
| Issue | Location | Recommended Fix |
|-------|----------|----------------|
| Kanban card text | deals-kanban.tsx | Increase title to `text-sm font-bold` |
| Deal value small | deals-kanban.tsx | `text-base font-extrabold` |
| Stage labels | deals-kanban.tsx | `text-xs font-bold` |

### Leads Page
| Issue | Location | Recommended Fix |
|-------|----------|----------------|
| (Check actual component) | leads page | Apply same table fixes as contacts |

### Settings Page
| Issue | Location | Recommended Fix |
|-------|----------|----------------|
| Section headers small | settings components | `text-sm font-extrabold uppercase` |
| Form labels | settings forms | `text-sm font-bold` |
| Input text | settings forms | `text-sm` → `text-base` |

---

## 9. SuperAdmin Pages

### SuperAdmin Sidebar
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Section headers | `text-xs font-extrabold uppercase` | OK | `text-sm font-extrabold` |
| Nav items | `text-sm font-bold` | OK | Keep |
| Active state | `bg-amber-50 dark:bg-amber-950/30` | OK | Keep |
| Icon default | `text-foreground/80 hover:scale-110` | OK | Keep |

### SuperAdmin Dashboard
| Property | Current | Issue | Recommended |
|----------|---------|-------|-------------|
| Main layout | `bg-gray-950` | Very dark | Keep |
| Card text | Uses dark theme | OK | Keep |
| Stat numbers | (`text-2xl` or `text-3xl`) | OK | `text-4xl font-black` |

---

## 10. Global Improvements Needed

### Contrast Issues (Current → Target)
| Context | Current | Target |
|---------|---------|--------|
| Muted text (light mode) | `hsl(215,10%,30%)` | `hsl(215,10%,20%)` |
| Muted text (dark mode) | `hsl(215,14%,80%)` | `hsl(215,14%,88%)` |
| Placeholder text | Via opacity | Ensure WCAG AA |
| Disabled state text | Via opacity | 40% minimum |

### Spacing Audit
| Element | Current | Target |
|---------|---------|--------|
| Main content padding | `p-3 sm:p-4` | `p-4 sm:p-5` |
| Card padding | `p-3` | Keep |
| Card internal sections | `px-3 py-2` | Keep |
| Table head padding | `px-3` | Keep |
| Table cell padding | `p-3` | Keep |
| Sidebar width | `w-[14.375rem]` (230px) | Keep |
| Grid gaps (dashboard) | `gap-3` | Keep |

### Font Size Hierarchy (Recommended)
| Context | Size | Weight |
|---------|------|--------|
| Page titles (h1) | 40px (2.5rem) | Extrabold |
| Section titles (h2) | 32px (2rem) | Extrabold |
| Card headers (h3) | 24px (1.5rem) | Bold |
| Sub-section headers | 20px (1.25rem) | Bold |
| Sidebar section headers | 16px (1rem) | Extrabold uppercase |
| Sidebar nav items | 15px (0.9375rem) | Extrabold |
| Body text (base) | 19px base → ~16px rendered | Medium 500 |
| Table headers | ~14px | Extrabold |
| Table cells | ~14px | Medium-Bold |
| Dashboard stat values | 36px (2.25rem) | Black 900 |
| Dashboard stat labels | 14px | Bold |
| Badges/chips | 13px | Bold |
| Secondary/meta text | 13px | Semibold |

### Space Wastage Elimination
| Area | Action |
|------|--------|
| Card borders | Removed (already done) |
| Card padding | Already compact (p-3) |
| Section internal spacing | Compact (divide-y with thin rows) |
| Page container | No max-width constraint (full width) |
| Sidebar | No wasted space (compact items) |
| Header height | OK as-is |
| Table rows | Compact (h-10 headers, p-3 cells) |

---

## Priority Action List

### P0 — Critical (Readability)
1. Increase `--muted-foreground` contrast further (light: 30→20%, dark: 80→88%)
2. Change all `text-[10px]`/`text-[9px]` badges to `text-xs font-bold`
3. Change all `text-[0.625rem]` section counts to `text-xs font-bold`
4. Ensure sidebar items use `text-foreground` (fully opaque)

### P1 — High (Font Sizing)
1. Sidebar nav items: `text-sm` → `text-[15px] font-extrabold`
2. Dashboard stat values: `text-3xl` → `text-4xl font-black`
3. Table headers: `font-bold` → `font-extrabold`
4. All form labels: `text-xs` → `text-sm font-bold`

### P2 — Medium (Spacing)
1. Sidebar header: workspace name `text-base` → `text-lg font-extrabold`
2. Main content padding: keep at `p-3 sm:p-4`
3. Stats icon container: `w-7 h-7` → `w-8 h-8`

### P3 — Low (Polish)
1. Hover animations: increase scale slightly
2. Active states: stronger shadows
3. Collapsed sidebar: bigger icons on hover

---

## File Change Map

| File | Changes Needed |
|------|---------------|
| `app/globals.css` | Update `--muted-foreground` values, increase html font-size to 125% |
| `components/tenant/layout/sidebar.tsx` | Increase nav item font size, section header size, count badge size, footer size |
| `components/superadmin/sidebar.tsx` | Increase nav item and section header sizes |
| `components/tenant/dashboard-client.tsx` | Increase stat value to `text-4xl font-black`, increase icon size |
| `components/ui/table.tsx` | TableHead: `font-extrabold text-foreground`, row hover: stronger |
| `components/tenant/contacts-client.tsx` | Replace all `text-[10px]` → `text-xs font-bold`, increase header size |
| `components/tenant/contacts-data-table.tsx` | Same badge/header fixes |
| `components/tenant/deals-data-table.tsx` | Same badge/header fixes |
| `components/tenant/deals-kanban.tsx` | Increase card title/value text sizes |
| `components/ui/badge.tsx` | Increase to `text-sm font-bold` |
