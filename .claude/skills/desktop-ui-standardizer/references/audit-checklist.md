# Desktop audit checklist

Run this before calling a desktop view done. Check at **1280px, 1440px and
1920px**, then confirm **≤768px is unchanged**.

## Layout

- [ ] At 1440px, content occupies ≥60% of the viewport width.
- [ ] The page is not one centred column of stacked cards.
- [ ] Multi-column wherever information benefits from side-by-side reading.
- [ ] Container is `max-w-7xl` (or `2xl:max-w-[1600px]` for dashboards), not a
      mobile-width column.
- [ ] Panels in the same row share a height; no ragged bottoms.
- [ ] No horizontal page scroll at any width; only tables/diagrams scroll, each
      inside its own `overflow-x-auto`.

## Transformation (not just resizing)

- [ ] Every multi-tier component changes *kind* between tiers, not only width.
- [ ] No carousel/swipe strip survives to `lg:` — it became a grid.
- [ ] Carousel autoplay timers, drag listeners and observers are disabled on
      desktop, not merely hidden.
- [ ] Bottom sheets / full-screen pushes became modals or side panels.
- [ ] `mobile → tablet → desktop` was designed deliberately; `md:` is not simply
      inherited from base.

## Navigation

- [ ] Desktop navigation is persistent and visible — no hamburger at `md:`+.
- [ ] Pages with ≥4 sibling sections have a sidebar or a persistent tab row.
- [ ] Primary actions are reachable without scrolling (sticky header where
      the page is long).

## Density

- [ ] Tables are tables on desktop; card-per-row exists only below `md:`.
- [ ] No panel whose entire content is one number.
- [ ] Secondary metadata sits in columns, not stacked under titles.
- [ ] Related information appears beside the primary content.
- [ ] Row height 36–44px; no phone-sized 56px+ blocks.

## Statistics

- [ ] Part-of-a-whole / rate statistics are infographic panels (chart + metric
      rows side by side), all visible at once.
- [ ] Feeds (notifications, announcements, timetable) were *not* charted.
- [ ] Chart colours follow the semantic table in `infographics.md`.
- [ ] Abbreviated values expose exact values via `title`.
- [ ] Segments deep-link to the same filtered views the mobile tiles do.

## Spacing

- [ ] One spacing scale (4/8/12/16/24/32); no `32 → 40 → 32 → 40` rhythm.
- [ ] Card padding `p-4 lg:p-5`; grid gaps `gap-4 lg:gap-5`; sections `py-5 lg:py-6`.
- [ ] Phone-tuned fixed heights became `lg:min-h-*`.
- [ ] Whitespace separates groups; inside a group it is tight.

## Typography

- [ ] Desktop ramp applied — section titles smaller, metric values larger.
- [ ] Nothing below 11px on desktop.
- [ ] Labels/metadata subordinate in colour, weight and size.
- [ ] Prose capped at `max-w-[70ch]`.
- [ ] `tabular-nums` on every column of numbers and every live-updating value.

## Interaction & a11y

- [ ] Hover state on every interactive row/panel/segment.
- [ ] Tooltips/`title` on abbreviated or truncated content.
- [ ] Real `<button>`/`<a>`; no clickable `<div>`.
- [ ] Visible `focus-visible` rings; hover-only detail also appears on focus.
- [ ] Esc closes overlays; tab order matches visual reading order.
- [ ] `role="img"` + `aria-label` on every SVG chart.
- [ ] `prefers-reduced-motion` respected.

## Regression

- [ ] Mobile layout byte-for-byte unchanged in behaviour (swipe, autoplay,
      conditional slots, deep links).
- [ ] Data fetching was not duplicated per breakpoint — one source of truth for
      the slot/panel list and its ordering.
- [ ] SSR-safe: first paint assumes mobile and upgrades on mount; no hydration
      mismatch from `window.innerWidth` read during render.
- [ ] `npx tsc --noEmit` and `npm run lint` clean.
