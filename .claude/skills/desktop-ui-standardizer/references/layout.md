# Desktop layout

## The three tiers

Design each tier explicitly. Write the row for the page you are working on before
you touch the markup.

| | mobile (base, <768) | tablet (`md:`, 768–1023) | desktop (`lg:`, ≥1024) |
|---|---|---|---|
| columns | 1 | 2 | 3–4 / 12-col grid |
| navigation | bottom nav + hamburger | persistent top nav | persistent top nav (+ sidebar where the page has sections) |
| stat cards | swipeable carousel | 2-up grid | infographic panels in a dashboard grid |
| lists | full-width rows | full-width rows | side panel beside primary content |
| tables | card-per-row fallback | scrollable table | full table, sticky header |
| detail views | full-screen push / bottom sheet | modal | split pane or right-hand contextual panel |

A component that appears at all three tiers must **transform** between them. If
the only diff is width, redo it.

## Container widths

```
max-w-7xl mx-auto px-4 sm:px-6 lg:px-8        /* standard page content (1280px) */
2xl:max-w-[1600px]                            /* dashboards/tables at very wide */
max-w-[70ch]                                  /* long-form prose */
```

Never leave a page whose content column is narrower than ~60% of a 1440px
viewport. Measure: `1440 - (2 × side margin)` — if the margins beat the content,
the layout is wrong.

Full-bleed strips (banners, section bands) span the viewport; their *contents*
still centre in the container above.

## Desktop shells

Pick one per page and keep it predictable:

1. **top nav + workspace** — the app's default (`Navbar` is already persistent at
   `md:` and up). Good for dashboards and single-subject pages.
2. **sidebar + content** — for pages with ≥4 sibling sections (settings,
   admin space, reports). Sidebar `w-56 lg:w-64`, sticky, scrolls independently;
   collapses into the existing mobile nav below `lg:`.
3. **sidebar + main + contextual panel** — a list/nav on the left, the record in
   the middle, metadata/actions on the right (`lg:grid-cols-[16rem_1fr]
   xl:grid-cols-[16rem_1fr_20rem]`). Use when a detail view currently opens a
   modal on desktop for no reason.

## Grid patterns that work here

```jsx
/* 12-col dashboard: a wide infographic panel beside a tall list panel */
<div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
  <section className="lg:col-span-7 xl:col-span-8">…primary…</section>
  <aside   className="lg:col-span-5 xl:col-span-4">…secondary…</aside>
</div>

/* Equal stat panels, denser as width allows */
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">…</div>

/* Split pane, independent scroll, full remaining height */
<div className="lg:grid lg:grid-cols-[22rem_1fr] lg:h-[calc(100dvh-4rem)]">
  <div className="lg:overflow-y-auto lg:border-r border-slate-200">…list…</div>
  <div className="lg:overflow-y-auto">…detail…</div>
</div>
```

Rules:
- Use `grid` for page structure and `flex` only inside a cell.
- Panels in one row should share a height (`items-stretch` + `h-full` on the
  card) — ragged bottoms read as broken on desktop.
- Fixed heights that were tuned for phones (`h-[260px]`) become minimums on
  desktop: `h-[260px] lg:h-full lg:min-h-[280px]`.

## Carousel → grid

A swipeable strip must not survive to desktop. Extract the slots into data, then
render two branches from the same array:

```jsx
const slots = [/* { key, heading, body, desktopBody?, span } */]

/* mobile/tablet: existing swipe strip */
<div className="lg:hidden">…slots.map(swipe track)…</div>

/* desktop: dashboard grid, everything visible at once */
<div className="hidden lg:grid lg:grid-cols-12 gap-5">
  {slots.map(s => <div key={s.key} className={spanClass(s.span)}>{s.desktopBody ?? s.body}</div>)}
</div>
```

Keep one source of truth for the slot list and its ordering; never fork the data
per breakpoint. Autoplay timers, drag listeners and `ResizeObserver` measurements
for the carousel must be disabled on desktop, not merely hidden — a hidden
carousel still ticking is a wasted render every 7s.

**Empty cards stay on desktop.** A carousel legitimately drops a card with
nothing in it — an empty slide is a wasted swipe. A dashboard does the opposite:
cards that appear and disappear with the data move every other card on the page,
so a user can never learn where anything is, and a missing panel is
indistinguishable from a panel that doesn't exist for them. On desktop keep every
card the role is entitled to and let it show its own zero/empty state (`0%`, "No
fees overdue", "You're all caught up").

Relax only the *has content* gate; role and user-preference gates still decide
who sees what:

```jsx
const showEmptyCards = isDesktop
if (isAdmin && (showEmptyCards || showFees)) slots.push(feeSlot)      // emptiness: relaxed
if (isStaff && (showEmptyCards ? !isAdmin || prefEnabled : hasTasks)) // preference: kept
```

This makes every card body's empty state load-bearing, so audit them: a card
whose "empty" is a blank box under a header needs a real empty state (icon,
one line of what it means, one line of reassurance) before it can be shown
unconditionally.

## Navigation

- Keep `hidden md:flex` for real nav and `md:hidden` for the hamburger. Never
  hide a desktop-capable nav behind a menu button.
- Sticky headers on desktop: `sticky top-0 z-30` with a solid/blurred background,
  so primary actions stay reachable without scrolling back up.
- Section-level sub-navigation on desktop belongs in a sidebar or a tab row that
  stays put — not in a `<select>`.

## JS-driven layout

Prefer CSS. When JS is unavoidable (measuring, virtualisation), use a single
shared hook (`useIsDesktop()` in `src/hooks/useMediaQuery.ts`) rather than
another ad-hoc `window.innerWidth` listener, and make sure the first paint is
SSR-safe (assume mobile, upgrade on mount).
