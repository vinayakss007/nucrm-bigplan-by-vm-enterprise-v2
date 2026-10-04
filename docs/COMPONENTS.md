# NuCRM UI Component Catalog

> **Read this before adding any UI component.** `components/ui/` has 24 components, and several
> jobs can already be done two or three different ways. Most of the wrong way is _silently_ worse:
> it still renders, it just drifts from the pattern the other 79 files converged on.
>
> - **Last verified:** 2026-10-04 (UTC) — every number below is measured, not estimated.
> - **Re-derive it:** see [How this was measured](#how-this-was-measured).
> - Counts move: this file was written while a second agent session was actively editing the same
>   repo (`confirm-dialog` went 78 → 79 and `error-boundary` 8 → 9 mid-write). Re-run the measurement
>   block before quoting a number.

## The one rule that matters most

**Use `confirmThen()` for every destructive confirmation.** It is the de-facto standard by a wide
margin: **79 files** import it, versus **4** that mount the `<ConfirmDialog>` component and **0**
that use `delete-confirm.tsx`.

```tsx
import { confirmThen } from "@/components/ui/confirm-dialog";

// promise-style: resolves true only if the user confirmed
if (!(await confirmThen({ title: "Delete contact", message: contact.name })))
  return;
await deleteContact(contact.id);
```

`confirmThen` is exported from `confirm-dialog.tsx:173`, **not** from the barrel — import it by path.
Do not hand-roll a `<Dialog>` + "Are you sure?" for a delete. If you need typed-to-confirm, use
`ConfirmWithInput` (`confirm-dialog.tsx:99`).

## Component reference

`used` = files outside `components/ui/` that import the component by path. `lines` = file length.

| Component                                            | File                  | lines | used   | Notes                                                                                |
| ---------------------------------------------------- | --------------------- | ----- | ------ | ------------------------------------------------------------------------------------ |
| `confirmThen` / `ConfirmDialog` / `ConfirmWithInput` | `confirm-dialog.tsx`  | 275   | **79** | **Standard for destructive actions.** Also exports `toastWithUndo`.                  |
| `Button`                                             | `button.tsx`          | 105   | 31     | cva variants; `buttonVariants` exported for link-as-button.                          |
| `Badge`                                              | `badge.tsx`           | 48    | 20     | `badgeVariants` for custom hosts.                                                    |
| `DropdownMenu*`                                      | `dropdown-menu.tsx`   | 206   | 15     | Radix. 10 sub-parts exported and unused.                                             |
| `DataTable`                                          | `data-table.tsx`      | 790   | 9      | TanStack Table v8 wrapper. **See the name collision below.**                         |
| `ErrorBoundary`                                      | `error-boundary.tsx`  | 97    | 9      | Also exports `withErrorBoundary` (0 uses).                                           |
| `Dialog` family                                      | `dialog.tsx`          | 128   | 7      | Radix. **Only for non-destructive flows.**                                           |
| `Checkbox`                                           | `checkbox.tsx`        | 36    | 6      | Radix.                                                                               |
| `Input`                                              | `input.tsx`           | 30    | 4      |                                                                                      |
| `PromptDialog`                                       | `prompt-dialog.tsx`   | 96    | 4      | Text-entry prompt.                                                                   |
| `Skeleton`                                           | `skeleton.tsx`        | 26    | 4      | Loading placeholder.                                                                 |
| `BulkActionBar`                                      | `bulk-action-bar.tsx` | 58    | 2      | Pairs with `DataTable` selection.                                                    |
| `OptimizedImage`                                     | `optimized-image.tsx` | 140   | 2      | Also exports `Avatar` (0 uses).                                                      |
| `Swipeable`                                          | `swipeable.tsx`       | 247   | 2      | Touch gesture wrapper.                                                               |
| `BottomSheet`                                        | `bottom-sheet.tsx`    | 150   | 1      | Mobile alternative to `Dialog`.                                                      |
| `InlineEdit`                                         | `inline-edit.tsx`     | 75    | 1      |                                                                                      |
| `SkipLink`                                           | `skip-link.tsx`       | 45    | 1      | A11y.                                                                                |
| `Table` primitives                                   | `table.tsx`           | 123   | 0      | **Internal only** — consumed by `data-table.tsx`, do not import directly from pages. |

## Choosing between the overlapping options

| You are doing                            | Use                            | Do **not** use                                                    |
| ---------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| Confirming a delete / destructive action | `confirmThen()`                | `<ConfirmDialog>`, `delete-confirm.tsx`, raw `<Dialog>`           |
| A plain modal (wizard, detail view)      | `Dialog`                       | `BottomSheet` (mobile-only affordance)                            |
| A modal **on mobile**                    | `BottomSheet`                  | `Dialog` (unreachable close on small screens)                     |
| Asking for a text value                  | `PromptDialog`                 | `ConfirmWithInput` (that one is for typed-to-confirm destructive) |
| A sortable/filterable list               | `DataTable` (`data-table.tsx`) | `data-table-optimized.tsx` — see below                            |
| A static HTML table                      | plain `<table>`                | `table.tsx` (internal primitive of `DataTable`)                   |
| Loading state                            | `Skeleton`                     | ad-hoc `animate-pulse` divs                                       |

## Uncited code

Nothing here is imported by any file outside `components/ui/` (measured by symbol **and** by path, so
barrel imports are included in the zero).

| File                       | lines | Status                                                                                                                                                                                                                            |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delete-confirm.tsx`       | 195   | Dead. A second implementation of what `confirmThen` already does.                                                                                                                                                                 |
| `data-table-optimized.tsx` | 226   | Dead, and **harmful** — see collision.                                                                                                                                                                                            |
| `card.tsx`                 | 140   | Dead. It _is_ exported from the barrel, so `import { Card } from '@/components/ui'` works, but nobody does it. The `<Card>` you see in `app/tenant/settings/ai-templates/page.tsx:242` is a **local** `function Card`, unrelated. |
| `pull-to-refresh.tsx`      | 147   | Dead.                                                                                                                                                                                                                             |
| `mobile-card.tsx`          | 141   | Dead. `Card`-shaped mobile variant.                                                                                                                                                                                               |
| `language-switcher.tsx`    | 39    | Dead.                                                                                                                                                                                                                             |

**Not deleted here.** 888 lines, and deleting shared UI is the other agent's call — say the word and
it goes in one commit with the barrel cleaned up at the same time.

## Known defects in this layer

1. **`DataTable` is defined twice.** `data-table.tsx:119` (`export function DataTable<TData, TValue>`)
   and `data-table-optimized.tsx:225` (`export const DataTable = memo(DataTableInner)`). They are
   different components with the same name. Import is resolved purely by file path, so a refactor
   that changes the path silently swaps which one you get.
2. **The barrel is not the public surface.** `components/ui/index.ts` has **7** `export` statements
   covering 10 components; **14 components are not in it**, including `DataTable`, `Table`,
   `confirmThen`, `ErrorBoundary`, `BottomSheet`, `InlineEdit`, `Swipeable`, `BulkActionBar`,
   `OptimizedImage` and `SkipLink`. So the codebase mostly imports by path, and the barrel is a
   partial lie about what exists.
3. **`npm run storybook` cannot run.** `.storybook/main.ts` + `preview.ts` and both `scripts` entries
   exist — but Storybook is **not installed**: no `node_modules/storybook`, no `@storybook/*`, and no
   entry in `package.json`. There is exactly **1** `*.stories.tsx` file (`button.stories.tsx`) in
   `app/` + `components/`. The Development scripts table in `README.md` used to advertise the script
   as a working "Storybook
   component library"; it now says the command cannot run. **This file is the catalog until Storybook
   is installed for real** — installing it means adding `storybook` + `@storybook/react-next` +
   `@storybook/addon-*` to `devDependencies` and writing stories for the 24 components, which is a
   task of its own.

## How this was measured

All commands from the repo root, nothing external:

```sh
# per-file adoption (path imports)
for f in components/ui/*.tsx; do n=$(basename "$f" .tsx);
  echo "$n: $(grep -rl --include=*.tsx --include=*.ts "ui/$n" app components lib | grep -v '^components/ui/' | wc -l)"; done

# the confirmThen vs ConfirmDialog split
grep -rl --include=*.tsx --include=*.ts "confirmThen" . | grep -v "components/ui/confirm-dialog" | wc -l   # 79
grep -rl --include=*.tsx -E "\bConfirmDialog\b" . | grep -v "^components/ui/" | wc -l                       # 4

# the dead six: 0 importers by path. (A path count alone can miss barrel imports, which is why
# `card` is checked by symbol too: the only `<Card>` in the app is a local `function Card` at
# app/tenant/settings/ai-templates/page.tsx:242, not this component.)
for n in card data-table-optimized delete-confirm pull-to-refresh mobile-card language-switcher; do
  printf '%-22s %s\n' "$n" "$(grep -rl --include=*.tsx --include=*.ts "ui/$n\b" app components lib \
    2>/dev/null | grep -v '^components/ui/' | wc -l)"
done

# DataTable defined twice
grep -rn "export function DataTable\|export const DataTable" components/ui/       # two hits, two files

# barrel coverage: 7 export statements for 24 components
grep -cE "^export" components/ui/index.ts

# storybook really missing — count DEPENDENCIES, not the word (the word appears in `scripts` too,
# where `grep -c storybook package.json` misleadingly answers 2)
python3 -c "import json;d=json.load(open('package.json'));print(len([k for k in {**d['dependencies'],**d['devDependencies']} if 'storybook' in k.lower()]))"   # 0
ls -d node_modules/storybook node_modules/@storybook 2>/dev/null                              # nothing
```

## Adding a component

1. Check [Choosing between the overlapping options](#choosing-between-the-overlapping-options) first —
   the default answer is usually "use what already exists".
2. One file in `components/ui/,` cva for variants, Radix for anything interactive. No new styling
   system and **no Bootstrap-derived kit** (Tabler, CoreUI) — see below.
3. Export it from `components/ui/index.ts` **and** keep path imports working. If you add it to the
   barrel, update this table in the same PR.
4. Give it a `*.stories.tsx` once Storybook is actually installed (defect 3). Until then this file is
   the catalog.
5. Never define a second component with an existing exported name (defect 1).

## What this stack is, and what it will not adopt

Tailwind 3.4.19 + `class-variance-authority` + `clsx` + 13 `@radix-ui/*` primitives — 13 direct
dependencies, all in `dependencies` and none in `devDependencies`, verifiable with
`Object.keys(require('./package.json').dependencies).filter(k => k.startsWith('@radix-ui')).length`.
(An earlier revision of this file said 17; that number is not reproducible from `package.json` and is
wrong here.) `lucide-react`,
with `@tanstack/react-{table,query,virtual}`, `@dnd-kit`, `recharts`, `date-fns`, `zod`,
`next-themes`, `react-hot-toast`.

**Tabler and other Bootstrap-5 kits are not compatible** — their CSS reset and utility classes collide
with Tailwind's. `@tabler/icons-react` (plain SVG) would be fine if only icons are wanted. For new
components, copy from the **shadcn/ui** registry — it is built on the same Radix + cva + Tailwind
model this directory already hand-rolls, so it adds components without adding a second component
model. `components.json` does not exist yet, which is why `npx shadcn add` is not currently usable.
