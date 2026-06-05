# NuCRM Brand Guidelines

> The definitive reference for NuCRM's visual identity, voice, and design language.

---

## 1. Logo Usage

### Concept

The NuCRM logo consists of the wordmark "Nu" rendered in a modern geometric sans-serif typeface, paired with a distinctive violet gradient dot that serves as both a period and a visual accent. The dot uses a radial gradient from `#7c3aed` to `#6366f1`, creating depth and energy.

### Variations

| Variation | Use Case |
|-----------|----------|
| **Full Logo** | Primary usage on marketing pages, headers, splash screens |
| **Icon Only** | Favicon, app icon, social media avatar (the violet gradient dot with an embedded "N" letterform) |
| **Wordmark** | Documentation headers, email signatures, contexts where the icon alone lacks recognition |
| **Monochrome** | Single-color printing, watermarks, low-contrast backgrounds |

### Minimum Sizes

- Full logo: minimum width of 120px (digital) or 30mm (print)
- Icon only: minimum 24px (digital) or 8mm (print)
- Wordmark: minimum 80px width (digital) or 20mm (print)

### Clear Space

Maintain clear space around the logo equal to the height of the "N" character on all sides. No other text, icons, or visual elements should intrude into this zone.

### Incorrect Usage

- Do not rotate or skew the logo
- Do not change the gradient colors
- Do not place on busy or low-contrast backgrounds without a container
- Do not add drop shadows or outer glows
- Do not stretch or distort proportions
- Do not rearrange the dot relative to the wordmark

---

## 2. Color Palette

### Primary

| Name | Hex | Usage |
|------|-----|-------|
| Violet 600 (Primary) | `#7c3aed` | Buttons, links, active states, primary CTAs |
| Violet 500 | `#8b5cf6` | Hover states, secondary emphasis |
| Violet 700 | `#6d28d9` | Active/pressed states |
| Violet 50 | `#f5f3ff` | Light backgrounds, subtle highlights |

### Secondary

| Name | Hex | Usage |
|------|-----|-------|
| Indigo 500 | `#6366f1` | Gradients paired with violet, secondary buttons |
| Cyan 500 | `#06b6d4` | Data visualizations, informational badges, accents |
| Cyan 400 | `#22d3ee` | Hover states for secondary elements |

### Accent

| Name | Hex | Usage |
|------|-----|-------|
| Amber 500 | `#f59e0b` | Warnings, highlights, premium badges |
| Amber 400 | `#fbbf24` | Hover for accent elements |

### Semantic Colors

| Name | Hex | Usage |
|------|-----|-------|
| Success | `#10b981` | Confirmations, positive states, completed actions |
| Error | `#ef4444` | Destructive actions, validation errors, alerts |
| Warning | `#f59e0b` | Caution states, pending actions |
| Info | `#06b6d4` | Informational messages, tips |

### Neutral Grays

| Step | Hex | Usage |
|------|-----|-------|
| 50 | `#f8fafc` | Page backgrounds (light mode) |
| 100 | `#f1f5f9` | Card backgrounds, dividers (light mode) |
| 200 | `#e2e8f0` | Borders, separators |
| 300 | `#cbd5e1` | Disabled text, placeholder |
| 400 | `#94a3b8` | Secondary text (light mode) |
| 500 | `#64748b` | Body text (light mode) |
| 600 | `#475569` | Headings (light mode) |
| 700 | `#334155` | Card backgrounds (dark mode) |
| 800 | `#1e293b` | Surface backgrounds (dark mode) |
| 900 | `#0f172a` | Page background (dark mode) |
| 950 | `#020617` | Deep backgrounds, overlays |

### Gradient Definitions

- **Primary Gradient**: `linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)`
- **Hero Gradient**: `linear-gradient(135deg, #7c3aed 0%, #06b6d4 50%, #6366f1 100%)`
- **Surface Glow**: `radial-gradient(ellipse at top, rgba(124,58,237,0.15) 0%, transparent 70%)`

---

## 3. Typography

### Font Families

| Role | Font | Fallback |
|------|------|----------|
| UI / Body | Inter | system-ui, -apple-system, sans-serif |
| Code / Mono | JetBrains Mono | ui-monospace, Consolas, monospace |

### Font Weights

- **Inter**: 400 (Regular), 500 (Medium), 600 (Semibold), 700 (Bold), 800 (Extrabold), 900 (Black)
- **JetBrains Mono**: 400 (Regular), 500 (Medium)

### Type Scale

| Name | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Display | 4.5rem (72px) | 900 | 1.0 | Hero headlines |
| H1 | 3rem (48px) | 800 | 1.1 | Page titles |
| H2 | 2.25rem (36px) | 700 | 1.2 | Section headings |
| H3 | 1.5rem (24px) | 600 | 1.3 | Subsection headings |
| H4 | 1.25rem (20px) | 600 | 1.4 | Card titles |
| Body Large | 1.125rem (18px) | 400 | 1.6 | Lead paragraphs |
| Body | 1rem (16px) | 400 | 1.5 | Default body text |
| Body Small | 0.875rem (14px) | 400 | 1.5 | Captions, metadata |
| Caption | 0.75rem (12px) | 500 | 1.4 | Labels, badges |
| Code | 0.875rem (14px) | 400 | 1.6 | Inline/block code |

### Usage Rules

- Headlines use tight letter-spacing (`tracking-tight` or `-0.025em`)
- Body text uses normal letter-spacing
- Code blocks use JetBrains Mono at 14px with relaxed line-height
- Never use more than 3 font weights on a single screen

---

## 4. Voice & Tone

### Personality

NuCRM speaks as a knowledgeable colleague who simplifies complexity. We are:

- **Professional yet approachable** - We respect our users' intelligence without being stuffy
- **Technical but clear** - We explain complex features in plain language
- **Confident, not arrogant** - We know our product is great without putting others down
- **Helpful, not patronizing** - We guide without over-explaining

### Writing Principles

1. **Lead with value** - Start with what the user gains, not what the feature does
2. **Use active voice** - "NuCRM syncs your contacts" not "Contacts are synced by NuCRM"
3. **Be concise** - Every word must earn its place
4. **Avoid jargon** - Unless your audience expects it (developer docs are an exception)
5. **Use "you" and "your"** - Make it personal and direct

### Word List

| Use | Instead of |
|-----|-----------|
| Dashboard | Control panel |
| Contacts | Leads/prospects (unless in pipeline context) |
| Workspace | Tenant/organization |
| Team | Users/members |
| Connect | Integrate |

---

## 5. Icon Style

### System

We use [Lucide Icons](https://lucide.dev) exclusively throughout the product.

### Specifications

- Default size: 24px (w-6 h-6)
- Small: 16px (w-4 h-4) for inline text, badges
- Large: 32px (w-8 h-8) for feature cards, empty states
- Stroke weight: 1.5px (consistent across all sizes)
- Style: Outlined only (never filled)
- Corner radius: Matches icon defaults (rounded joins)

### Usage Rules

- Always pair icons with text labels in navigation
- Use icons alone only when meaning is universally clear (close, search, settings)
- Maintain consistent sizing within a component group
- Apply `text-current` to inherit parent color
- Never mix icon sets (no FontAwesome, Heroicons, etc.)

---

## 6. Component Patterns

### Border Radius

- Buttons: `rounded-xl` (12px)
- Cards: `rounded-xl` (12px) or `rounded-2xl` (16px) for feature cards
- Inputs: `rounded-lg` (8px)
- Badges/chips: `rounded-full`
- Modals: `rounded-2xl` (16px)

### Shadows

- Cards: `shadow-lg` with primary color tint: `shadow-violet-500/5`
- Elevated elements: `shadow-xl shadow-violet-500/10`
- Buttons (hover): `shadow-lg shadow-violet-500/25`
- Never use hard black shadows

### Glass-morphism Cards

```css
/* Standard glass card */
backdrop-filter: blur(16px); /* backdrop-blur-xl */
background: rgba(255, 255, 255, 0.8); /* bg-white/80 */
border: 1px solid rgba(255, 255, 255, 0.2);

/* Dark mode glass card */
background: rgba(15, 23, 42, 0.8); /* bg-slate-900/80 */
border: 1px solid rgba(148, 163, 184, 0.1);
```

### Gradient Buttons

```css
/* Primary CTA */
background: linear-gradient(135deg, #7c3aed, #6366f1);
/* Hover: shift gradient */
background: linear-gradient(135deg, #6d28d9, #4f46e5);
```

### Transitions

- All interactive elements: `transition-all duration-200`
- Hover transforms: `hover:scale-105` for cards, `hover:-translate-y-0.5` for buttons
- Color transitions: `transition-colors duration-150`

---

## 7. Dark / Light Mode

### Strategy

- **Dark mode is primary** - designed first, optimized for extended use
- **Light mode is secondary** - clean, minimal, professional
- Toggle via `class` strategy on `<html>` element

### Color Mapping

| Element | Dark Mode | Light Mode |
|---------|-----------|------------|
| Page background | `#0f172a` (slate-900) | `#ffffff` |
| Surface / Cards | `#1e293b` (slate-800) | `#ffffff` |
| Elevated surface | `#334155` (slate-700) | `#f8fafc` (slate-50) |
| Primary text | `#f8fafc` (slate-50) | `#0f172a` (slate-900) |
| Secondary text | `#94a3b8` (slate-400) | `#64748b` (slate-500) |
| Borders | `rgba(148,163,184,0.1)` | `#e2e8f0` (slate-200) |
| Primary accent | `#7c3aed` (same) | `#7c3aed` (same) |
| Hover background | `rgba(124,58,237,0.1)` | `rgba(124,58,237,0.05)` |

### Implementation

- Use Tailwind's `dark:` variant prefix
- CSS variables defined in `:root` and `.dark` selectors
- Primary/accent colors remain constant across themes
- Semantic colors adjust slightly for contrast (e.g., success is brighter in dark mode)

---

## 8. Spacing Scale

### Base Unit

4px (0.25rem) - all spacing derives from this base.

### Scale (Tailwind)

| Class | Value | Usage |
|-------|-------|-------|
| `p-1` / `m-1` | 4px | Tight padding (badges) |
| `p-2` / `m-2` | 8px | Input padding, icon gaps |
| `p-3` / `m-3` | 12px | Button padding |
| `p-4` / `m-4` | 16px | Card padding, section gaps |
| `p-6` / `m-6` | 24px | Card content padding |
| `p-8` / `m-8` | 32px | Section spacing |
| `p-12` / `m-12` | 48px | Large section gaps |
| `p-16` / `m-16` | 64px | Page section spacing |
| `p-24` / `m-24` | 96px | Hero section padding |

### Layout Grid

- Max content width: `max-w-7xl` (80rem / 1280px)
- Responsive columns: 1 (mobile) -> 2 (tablet) -> 3-4 (desktop)
- Gap between grid items: `gap-6` (24px) standard, `gap-8` (32px) for feature grids

---

## 9. Do's and Don'ts

### Do

- Use the violet gradient for primary CTAs
- Maintain consistent border-radius within component groups
- Pair every icon with descriptive text in navigation
- Use glass-morphism sparingly for hero sections and featured cards
- Test all colors for WCAG AA contrast compliance
- Use `transition-all duration-200` for smooth interactions
- Keep text under 65 characters per line for readability
- Use the defined type scale - avoid arbitrary font sizes

### Don't

- Don't use pure black (`#000000`) - use slate-950 (`#020617`) instead
- Don't mix icon libraries - Lucide only
- Don't use more than 3 gradient stops in a single gradient
- Don't apply glass-morphism to every card - reserve it for emphasis
- Don't use shadows without the violet tint in dark mode
- Don't create new colors outside the defined palette
- Don't use font weights below 400 (thin/light variants reduce readability)
- Don't apply animations to critical UI elements that users interact with rapidly
- Don't use borders heavier than 1px on cards
- Don't center-align body text longer than 2 lines

---

## 10. Motion & Animation

### Principles

- **Purposeful** - Every animation communicates something (entry, state change, feedback)
- **Quick** - Most transitions complete in 150-300ms
- **Subtle** - Motion enhances, never distracts
- **Respectful** - Honor `prefers-reduced-motion` media query

### Timing Functions

- Default: `cubic-bezier(0.4, 0, 0.2, 1)` (ease-out)
- Enter: `cubic-bezier(0, 0, 0.2, 1)` (ease-out)
- Exit: `cubic-bezier(0.4, 0, 1, 1)` (ease-in)
- Spring: `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot)

### Duration Scale

| Duration | Usage |
|----------|-------|
| 100ms | Micro-interactions (hover color) |
| 150ms | Button state changes |
| 200ms | Standard transitions |
| 300ms | Card/modal enter |
| 500ms | Page transitions |
| 1000ms+ | Decorative/ambient only |

---

## 11. Responsive Breakpoints

| Name | Min Width | Tailwind Prefix |
|------|-----------|-----------------|
| Mobile | 0px | (default) |
| Small | 640px | `sm:` |
| Medium | 768px | `md:` |
| Large | 1024px | `lg:` |
| XL | 1280px | `xl:` |
| 2XL | 1536px | `2xl:` |

### Mobile-First Approach

- Design for mobile first, then enhance for larger screens
- Navigation collapses to hamburger menu below `md:`
- Cards stack vertically below `sm:`
- Reduce padding and margins on mobile (e.g., `p-4 md:p-8 lg:p-12`)
