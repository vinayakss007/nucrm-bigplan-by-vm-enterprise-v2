# Settings Layout Redesign — Issue Report

## Current State: Wasted Screen Real Estate

### Problem Summary

Settings pages across both the **CRM tenant settings** and **Super Admin panel** use narrow `max-w-*` constraints that waste 40-60% of available screen width. Content is crammed into small card boxes in the center while most of the screen remains empty.

---

## Tenant Settings Pages (19 pages) — The Worst Offenders

| Page | Current max-width | Screen Used (1920px) |
|---|---|---|
| email, general, profile, security, sessions, telegram | `max-w-2xl` (672px) | **35%** |
| api-keys, backup, billing, integrations, pipelines, portal, webhooks | `max-w-3xl` (768px) | **40%** |
| roles | `max-w-4xl` (896px) | **47%** |
| admin, industry-templates | `max-w-5xl` (1024px) | **53%** |
| custom-fields | `max-w-[1200px]` | **62%** |

**13 of 19 settings pages waste more than half the screen.**

### Visual Examples of the Problem

**Profile Page (`/app/tenant/settings/profile/page.tsx` — max-w-2xl):**
```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────┐       │
│  │   Profile info in a narrow box                   │       │
│  │   Lots of empty space on both sides              │       │
│  └──────────────────────────────────────────────────┘       │
│  ┌──────────────────────────────────────────────────┐       │
│  │   Notification prefs in another box              │       │
│  └──────────────────────────────────────────────────┘       │
│                                                             │
│  ← 672px →                    ← 1248px empty →             │
└─────────────────────────────────────────────────────────────┘
```

**Security Page (`/app/tenant/settings/security/page.tsx` — max-w-2xl):**
Same problem. 2FA setup, password change, session management all in a 672px strip.

**Backup Page (`/app/tenant/settings/backup/page.tsx` — max-w-3xl):**
Complex configuration with schedules, records, and alerts cramped in 768px.

---

## Super Admin Settings — Better But Still Inconsistent

| Page | Current max-width | Issue |
|---|---|---|
| settings | `max-w-3xl` (768px) | Only superadmin page with narrow layout — inconsistent with rest |
| announcements, health | `max-w-4xl` | Medium width but could use full area |
| dashboard, monitoring, analytics | `max-w-7xl` | Good — uses available space |
| backups, token-control | `max-w-[1400px]` | Good |
| data-explorer | `max-w-[1600px]` | Best practice — uses nearly full width |

**The super admin settings page is the outlier** — it's the only superadmin page stuck at 768px while all others use 1152px–1600px.

---

## Root Causes

1. **No unified settings layout** — Each settings page independently defines its own `max-w-*` constraint. There's no shared settings shell/layout.

2. **No settings sub-navigation** — Settings navigation lives only in the main sidebar's collapsible menu. There's no inline tabs or sidebar within settings pages themselves.

3. **`admin-card` pattern encourages boxing** — Most settings pages wrap content in `admin-card` divs that look like small cards, reinforcing the narrow mental model.

4. **Single-column obsession** — Even wide pages like `admin` (max-w-5xl) still flow content in a single column rather than using multi-column grids.

---

## Redesign Requirements

### 1. Full-Width Settings Shell
Create a shared settings layout (`/app/tenant/settings/layout.tsx`) that:
- Uses full available width (no `max-w-*` constraint)
- Provides consistent padding: `p-6 lg:p-8`
- Includes a settings-specific sub-navigation (tabs or inline sidebar)

### 2. Settings Sub-Nav
Add an inline tab bar or left sidebar within settings showing all settings sections:
```
[Profile] [Workspace] [Security] [Email] [Integrations] [Backup] ...
```
Active tab highlights, smooth transitions. This makes settings navigation accessible even when the main sidebar is collapsed.

### 3. Remove Artificial max-w Constraints
Each settings page should use the full width from the shell layout:
- Remove `max-w-2xl`, `max-w-3xl`, `max-w-4xl`, `max-w-5xl` from individual pages
- Let content flow naturally to fill available space
- Use CSS Grid for multi-column layouts on dense pages

### 4. Specific Page Layouts

**Profile Page:**
- Left column: Avatar + name (compact)
- Right column: Edit form in two-column grid
- Full width for notification preferences with inline toggles

**Security Page:**
- Two-column grid: Password change + 2FA side by side
- Sessions table uses full width
- IP whitelist section full width

**Backup Page:**
- Tabbed interface (like superadmin backups)
- Schedules, records, alerts as tabs
- Each tab uses full width

**Team Page:**
- Member list as a data table (full width)
- Invite form inline or as a slide-over panel
- Role badges and quick-actions in table rows

**API Keys Page:**
- Full-width table with inline create/edit
- Key prefix, scopes, status columns

### 5. Super Admin Settings Page
Bring inline with other superadmin pages:
- Change `max-w-3xl` to `max-w-6xl` minimum
- Add sub-navigation for superadmin settings sections
- Use consistent dark theme styling matching the rest of superadmin

### 6. Responsive Behavior
- Desktop (>1280px): Full width, multi-column where appropriate
- Tablet (768-1280px): Slightly reduced padding, single column
- Mobile (<768px): Current narrow layout works, keep as-is

---

## Implementation Priority

| Priority | Page | Effort | Impact |
|---|---|---|---|
| P0 | Create `/app/tenant/settings/layout.tsx` with sub-nav | Medium | All 19 pages benefit |
| P0 | Remove `max-w-*` from all tenant settings pages | Low | Immediate visual improvement |
| P1 | Profile page redesign | Low | First impression for users |
| P1 | Security page two-column layout | Medium | Dense page needs space |
| P1 | Team page full-width table | Medium | Most-used settings page |
| P2 | Backup page tabs | Medium | Complex config needs room |
| P2 | API Keys full-width table | Low | Simple change |
| P2 | Super admin settings → max-w-6xl | Low | Consistency fix |
| P3 | Email, integrations, portal pages | Low | Less critical pages |

---

## Files to Modify

### New Files to Create
- `app/tenant/settings/layout.tsx` — Settings shell with sub-navigation

### Files to Modify (max-w constraints to remove)
- `app/tenant/settings/profile/page.tsx` — remove max-w-2xl
- `app/tenant/settings/security/page.tsx` — remove max-w-2xl
- `app/tenant/settings/general/page.tsx` — remove max-w-2xl
- `app/tenant/settings/sessions/page.tsx` — remove max-w-2xl
- `app/tenant/settings/telegram/page.tsx` — remove max-w-2xl
- `app/tenant/settings/email/page.tsx` — remove max-w-2xl
- `app/tenant/settings/api-keys/page.tsx` — remove max-w-3xl
- `app/tenant/settings/backup/page.tsx` — remove max-w-3xl
- `app/tenant/settings/billing/page.tsx` — remove max-w-3xl
- `app/tenant/settings/integrations/page.tsx` — remove max-w-3xl
- `app/tenant/settings/pipelines/page.tsx` — remove max-w-3xl
- `app/tenant/settings/portal/page.tsx` — remove max-w-3xl
- `app/tenant/settings/webhooks/page.tsx` — remove max-w-3xl
- `app/tenant/settings/roles/page.tsx` — remove max-w-4xl
- `app/superadmin/settings/page.tsx` — change max-w-3xl to max-w-6xl

### Files with Layout Improvements
- `app/tenant/settings/security/page.tsx` — two-column grid
- `app/tenant/settings/backup/page.tsx` — tabbed interface
- `app/tenant/settings/team/page.tsx` — full-width data table
- `components/tenant/settings/` — audit-client, team-client width fixes

---

## Success Metrics

- 100% of settings pages use full available width (no wasted space on screens >1024px)
- Settings sub-navigation visible on all settings pages
- No regressions in mobile layout
- Consistent width between CRM settings and superadmin settings
