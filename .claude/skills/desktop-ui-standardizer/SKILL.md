---
name: desktop-ui-standardizer
description: Design and audit the desktop (≥1024px) view of any page in this app so it is a real desktop layout rather than a stretched mobile page. Use when working on desktop views, wide-screen layouts, dashboards, responsive breakpoints, information density, desktop navigation, or when converting stacked mobile cards / swipeable carousels into multi-column grids, tables, split panes and infographic statistic panels.
---

# Desktop UI Standardizer

This app was built mobile-first. Most pages are a single narrow column of stacked
cards centred in a `max-w-7xl` container, which on a 1440–2560px screen reads as a
phone screenshot floating in empty space. This skill is the standard for fixing
that, and the checklist for not regressing it.

**The rule everything else serves: the desktop view is its own layout, not the
mobile layout with more air around it.** If a change only makes things wider or
bigger, it has not been done.

## Workflow

1. **Inspect before designing.** Read the page and find its current breakpoints
   (`grep -n "sm:\|md:\|lg:\|xl:\|2xl:" <file>`) and any JS-driven layout
   (`window.innerWidth`, `matchMedia`, `ResizeObserver`). Write down what the
   layout actually does at each of the three tiers below before changing it.
2. **Design three tiers deliberately** — mobile → tablet → desktop — and state
   what *transforms* at each, not just what resizes. See `references/layout.md`.
3. **Pick the desktop shell**: `sidebar + content`, `top nav + workspace`, or
   `sidebar + main + contextual panel`. Do not default to "one centred column".
4. **Raise density**: collapse stacked cards into grids, tables, split panes and
   summary panels. See `references/density-and-spacing.md`.
5. **Re-cut typography and spacing for desktop** — a separate hierarchy, not
   scaled-up mobile type. See `references/typography.md`.
6. **Check against `references/audit-checklist.md`** before calling it done, and
   verify at 1280px, 1440px and 1920px (and that ≤768px is unchanged).

## Breakpoints in this codebase

Tailwind defaults, used as three tiers:

| Tier | Range | Layout intent |
|---|---|---|
| mobile | `< 768px` (base) | single column, swipe/scroll, touch targets ≥44px |
| tablet | `md:` 768–1023px | 2 columns, persistent top nav, no carousel |
| desktop | `lg:` ≥1024px (`xl:` 1280, `2xl:` 1536 for refinement) | multi-column dashboard/grid, persistent nav, dense panels |

`md:` is the tablet hinge and `lg:` is the desktop hinge. Do not invent new
breakpoints; refine inside these with `xl:`/`2xl:`.

## Non-negotiables

**Layout**

- Use the horizontal space. Multi-column wherever information benefits from
  side-by-side reading; `max-w-7xl` (or `2xl:max-w-[1600px]` for dashboards) as
  the container, never a permanently mobile-width column.
- No giant empty side margins from a mobile-centred layout. If the content column
  is under ~60% of the viewport at 1440px, redesign it.
- Grids, split panes, tables, dashboards and secondary panels are the desktop
  vocabulary. Reach for them first.
- Persistent desktop navigation/sidebars where the page has more than a couple of
  destinations.

**Interaction**

- Replace long runs of mobile stacked cards with a denser hierarchy.
- Primary actions stay visible without scrolling.
- Hover states, tooltips and contextual (row/panel-level) actions on desktop —
  they cost nothing on touch because they sit behind `@media (hover: hover)`.
- No hamburger when the nav can stay visible (`hidden md:flex` nav + `md:hidden`
  hamburger is the pattern already in `Navbar.tsx` — keep it that way).
- Keyboard-friendly: real `<button>`/`<a>`, visible focus rings, Esc closes
  overlays, arrow keys where a list/grid is genuinely navigable.
- Click targets stay comfortable (~32–40px on desktop) — not phone-sized 56px
  blocks everywhere.

**Information density**

- Desktop shows more at once. Tables stay tables; never explode a table into
  full-width cards on desktop (card-per-row is a *mobile* fallback only).
- Related information sits beside the primary content, not below it.
- Secondary metadata moves into columns rather than stacking vertically.

**Spacing**

- One spacing system, no `32px → 40px → 32px → 40px` mobile rhythm around every
  element. Desktop steps: `4 / 8 / 12 / 16 / 24 / 32` px (`gap-1 … gap-8`).
- Section rhythm on desktop: `py-6`/`gap-5`, not `py-10` everywhere. Whitespace
  earns its place by creating hierarchy, not by decorating.

**Typography**

- Desktop gets its own hierarchy: page title ~2rem, section title ~1.125–1.25rem,
  body 14px, metadata 11–12px. Don't scale the mobile ramp up wholesale.
- Long-form text: cap at `max-w-[70ch]`.
- Labels/metadata are visually subordinate (lighter weight, `text-slate-400/500`,
  uppercase `.eyebrow` for kickers) — not the same weight as content.
- Nothing below 11px on desktop. The 9.5px tile labels used on mobile must step
  up (`text-[9.5px] lg:text-[11px]`).

**Responsive behaviour**

- Every component that survives all three tiers must *transform*, not just
  reflow: carousel → grid, accordion → split pane, cards → table, bottom sheet →
  side panel, stacked KPI tiles → infographic panel.
- Never ship a desktop layout whose only difference from mobile is width.

## Statistic sections → infographics (admin dashboards)

Swipeable KPI cards are a mobile affordance. On desktop, statistics become
**infographic panels**: a chart carrying the shape of the data, with the numbers
read off beside it.

- Fee, bus-fee and attendance-style summaries get a donut/meter + labelled metric
  rows, all visible at once — no swiping between them.
- Not every swipeable card becomes an infographic. Lists (notifications,
  announcements, timetable, assessments) stay lists; they just get placed in the
  grid beside the stat panels.
- Use the repo's dependency-free SVG primitives in `src/components/charts/`
  (`DonutChart`, `MetricBars`, `LineChart`) — do not add a charting library.
- Keep the existing mobile carousel intact and render the desktop dashboard as a
  separate branch (`useIsDesktop()` / `hidden lg:grid`). Never regress mobile to
  serve desktop.

See `references/infographics.md` for the panel anatomy and the chart primitives'
contracts.

## Repo conventions to preserve

- Surfaces: `.glass-card` (rounded, frosted — student/shared) and `.pro-card`
  (square, crisp — staff/admin reporting). Don't mix them within one panel.
- `.pro-chrome` squares off every corner in a subtree; admin/reporting desktop
  panels belong inside it.
- `SectionHeading` (icon chip + `.eyebrow` kicker + `.headline` title + action) is
  the section header everywhere. Give it desktop sizes rather than a second
  component.
- Brand colours come from `--brand-primary`/`--brand-secondary`; page palettes
  from `[data-page-theme]`. Chart colours: emerald = good/collected/present,
  amber = warning/irregular, red/rose = bad/absent/overdue, sky/teal = neutral.
- Animations use framer-motion with `opacity`/`transform` only (see the comment on
  `itemVariants` in `src/app/home/page.tsx` — never animate `filter`).
- Respect `prefers-reduced-motion`, already honoured in `globals.css`.

## Reference files

- `references/layout.md` — shells, grids, container widths, the three-tier table.
- `references/density-and-spacing.md` — density patterns, tables vs cards, spacing scale.
- `references/typography.md` — desktop type ramp and subordination rules.
- `references/infographics.md` — stat panel anatomy, chart primitives, colour semantics.
- `references/audit-checklist.md` — run before declaring a desktop view done.
