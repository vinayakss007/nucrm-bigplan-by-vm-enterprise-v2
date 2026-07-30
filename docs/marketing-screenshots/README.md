# Marketing site screenshots

Captures of the public marketing site (`app/(marketing)`) taken from a
production build, for design review on the pull request. These are review
artifacts, not assets — nothing in the application imports them.

## Regenerating

Both scripts run against an already-running production server and need
Chromium installed for Playwright.

```bash
npm run build
npx next start -p 3112 &

# page-level captures: hero, sub-pages, footer, mobile
node scripts/marketing-screenshots.mjs http://127.0.0.1:3112 docs/marketing-screenshots

# per-section captures plus menu interaction states
node scripts/marketing-sections.mjs   http://127.0.0.1:3112 docs/marketing-screenshots
```

Both scripts run the browser with `reducedMotion: 'reduce'`. The site's
scroll-reveal sections start at `opacity: 0` and its counters animate from zero,
so without that flag any section the script never scrolled past would capture
blank and every statistic would read `0`. `marketing.css` keeps `.mk-reveal`
fully visible under that media query, which makes the captures deterministic.

Section captures also scroll to 90px above the target, because the header is
fixed and would otherwise sit on top of each section's own eyebrow.

## What is here

| File                      | Shows                                       |
| ------------------------- | ------------------------------------------- |
| `01-landing-hero-desktop` | Hero at 1440px, 2×                          |
| `03-landing-hero-mobile`  | Hero at 390px, 2×                           |
| `04-features-hub`         | `/features` pillar grid                     |
| `05-feature-ai`           | `/features/ai` deep page                    |
| `06-solution-real-estate` | `/solutions/real-estate` blueprint contents |
| `07-compare-hubspot`      | `/compare/hubspot`                          |
| `08-pricing`              | `/pricing` plan cards                       |
| `09-abetworks-studio`     | `/abetworks` product family                 |
| `10-footer`               | Mega footer — the full site map             |
| `11-stack-consolidation`  | Landing: the twelve-tools argument          |
| `11b-stats`               | Landing: platform scale band                |
| `12-bento-capabilities`   | Landing: capability bento grid              |
| `13-product-tour`         | Landing: tabbed product tour                |
| `14-integrations`         | Landing: connectors                         |
| `15-compare-table`        | Landing: competitor matrix                  |
| `16-pricing-preview`      | Landing: plan preview                       |
| `17-faq`                  | Landing: FAQ                                |
| `18-mega-menu-product`    | Desktop mega menu, open                     |
| `19-mobile-menu`          | Mobile drawer, Solutions expanded           |
| `20-mobile-pricing`       | Pricing on mobile                           |
| `21-hero-1920`            | Hero at 1920px                              |

The full-page landing capture is deliberately excluded: it is roughly 9000px
tall, so it is unreadable at any size a reviewer would view it, and it cost
2.3 MB. The per-section images cover the same ground legibly.

## Defects these captures caught

All of the following passed typecheck, lint and `next build` without complaint,
and were only visible once the pages were rendered and looked at:

1. Negative z-index glow layers painting behind `.mk-root`'s own background, so
   the whole site rendered flat black.
2. `Zap`, `Shuffle` and `Gift` missing from the icon map, silently falling back
   to a sparkle on the landing page's main feature grid.
3. Sticky table headers being translucent, so row text read through the column
   labels on the comparison matrix.
4. Mega-menu panels relying on `backdrop-filter` for legibility, leaving the
   hero headline readable through an open menu wherever compositing is skipped.
5. Anchored sections landing under the fixed header.
6. Acronyms mangled by blind lowercasing — "Go deeper on ai".

Worth re-running these scripts after any change to `marketing.css` or the
shared components in `components/marketing/`.
