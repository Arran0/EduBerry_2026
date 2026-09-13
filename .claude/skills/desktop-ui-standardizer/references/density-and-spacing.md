# Information density & spacing

## Density

Desktop can show more at once, and should. The failure mode to hunt for is a
column of big cards each holding one fact.

Convert, in order of preference:

| Mobile pattern | Desktop replacement |
|---|---|
| stacked KPI cards | one infographic panel: chart + metric rows |
| swipeable card strip | dashboard grid, all panels visible |
| card-per-row list | table with sortable columns and a sticky header |
| accordion sections | split pane, or all sections open in columns |
| "tap to see detail" page push | contextual right-hand panel |
| full-width single stat | a metric row inside a shared panel |

### Tables

- On desktop a table is a table. Columns, aligned numbers (`tabular-nums`),
  right-aligned amounts, sticky `<thead>`, zebra or hairline row dividers,
  row hover, and row-level contextual actions revealed on hover.
- Card-per-row is the **mobile fallback only**: `<table className="hidden md:table">`
  plus a `md:hidden` card list, or a single component that switches.
- Row height on desktop: 36–44px. Not 72px.
- Put secondary metadata in its own column, not a second line under the title.

### Panels

- A panel = one heading + dense content. Don't wrap every child in its own card;
  nested cards add borders and shadows without adding information.
- Related information belongs beside the primary content: a ledger's totals sit
  next to the ledger, not above it in a separate band.

## Spacing scale

One system, used everywhere:

```
4   gap-1   hairline grouping (icon ↔ label)
8   gap-2   within a control / tile
12  gap-3   between rows in a dense list
16  gap-4   between cards in a grid (desktop default)
24  gap-6   between sections
32  gap-8   between major page regions (use sparingly)
```

Desktop padding:

- card/panel padding: `p-4 lg:p-5` (dense reporting panels: `p-3 lg:p-4`)
- section vertical rhythm: `py-5 lg:py-6`
- grid gaps: `gap-4 lg:gap-5`

Anti-patterns:

- The mobile `32 → 40 → 32 → 40` rhythm around every element. Desktop sections
  are separated by 24px, not 40px.
- `space-y-6` on a container whose children already carry `mb-*`.
- Padding tuned so a single card fills a phone screen (`py-10`, `h-[260px]` for a
  four-number tile). On desktop those become `py-5` and `min-h-[280px]`.
- Whitespace used as decoration. Whitespace should separate *groups*; inside a
  group, tighten.

## Touch vs pointer

- Desktop click targets: 32–40px tall for rows and buttons; 24px is acceptable
  for icon-only contextual actions inside a hovered row.
- Do not carry phone-sized 56px blocks onto desktop — the size no longer signals
  importance, it signals a stretched mobile page.
- Keep `active:scale-95` for touch but pair it with a real `hover:` state for
  pointer devices (behind `@media (hover: hover)` where it's a CSS class).

## Hover, tooltips, contextual actions

- Every interactive row/panel gets a hover affordance (background tint or border
  emphasis) so the pointer is informative.
- Put exact values behind a `title`/tooltip when a number is abbreviated
  (`₹1.2L` → `₹1,23,400`).
- Row actions (edit, export, open) appear on row hover on desktop; on mobile they
  stay visible or move into the row's tap target.
- Never make hover the *only* route to an action — keyboard focus must reveal it
  too (`group-hover:opacity-100 group-focus-within:opacity-100`).

## Keyboard

- Real `<button>`/`<a>` elements; never a clickable `<div>`.
- Visible focus: `focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-sky-500/60`.
- Esc closes modals/panels; Enter activates the focused row; arrow keys move
  within grids and lists that are genuinely navigable.
- Logical tab order: the DOM order of a desktop grid must match reading order.
