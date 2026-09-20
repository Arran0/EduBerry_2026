# Statistic sections → desktop infographics

On mobile, an admin's headline statistics live in a swipeable strip of cards,
each a 2×2 grid of numbers. That is a phone affordance: only one card fits, so
the rest are hidden behind a gesture. On desktop every statistic should be
visible simultaneously, and each one should carry the *shape* of its data, not
just its magnitude.

## What becomes an infographic — and what doesn't

Convert to an infographic panel when the data has parts of a whole, a rate, or a
comparison:

- Fee collection (collected vs outstanding, today's collection, students in dues)
- Bus fee collection (same shape, transport scope)
- Attendance (present / absent / irregular, students and staff, attendance rate)
- Payroll, admissions, exam results — anything with a denominator

Leave as a list/panel (place it in the grid, don't chart it):

- Notifications, announcements, timetable, assessments, report cards, grading
  queues, task calendars — these are *feeds*, and a chart of a feed is noise.

> Not every swipeable card needs to be replaced this way. Ask: does this card
> have a whole that its parts divide? If not, it stays a list.

## Panel anatomy

```
┌───────────────────────────────────────────────────────────────┐
│ ▣ SCHOOL          Fee Collection                   View all → │  SectionHeading
├───────────────────────────────────────────────────────────────┤
│    ╭───────╮     ┌───────────────────────────────────────┐    │
│   ╱  68%    ╲    │ ● Collected      ₹12.4L         68%   │    │  donut + metric rows
│  │ collected │   │ ● Outstanding     ₹5.8L         32%   │    │
│   ╲         ╱    └───────────────────────────────────────┘    │
│    ╰───────╯                                                  │
├───────────────────────────────────────────────────────────────┤
│  Today's collection  ₹42,000  │  Students with dues     37    │  footer metrics
└───────────────────────────────────────────────────────────────┘
```

Rules:

1. **One chart, one idea.** The donut answers "how much of the whole is done?";
   everything else is read off the rows beside it.
2. **Chart and numbers side by side**, never chart above numbers — that wastes
   the width you are here to use.
3. **Every segment is a link** to the filtered view it represents (the mobile
   tiles already deep-link; keep those hrefs).
4. **Exact values on hover** via `title` when the display value is abbreviated.
5. **Footer metrics** carry the leftover scalars (today's collection, counts) in
   a hairline-separated row — subordinate type, not more tiles.
6. Panels in one dashboard row share a height (`h-full`) and the same surface
   (`.pro-card` for admin/reporting).

## Chart primitives (`src/components/charts/`)

Dependency-free SVG, matching the approach already used by `LineChart` and the
tasks donut. **Do not add a charting library.**

### `DonutChart`

```tsx
<DonutChart
  segments={[
    { label: 'Collected',   value: 1240000, color: '#10b981', href: '/more/fees?filter=collected' },
    { label: 'Outstanding', value:  580000, color: '#f59e0b' },
  ]}
  size={132}            // px, outer diameter
  thickness={14}        // ring width
  centerValue="68%"     // big number in the hole
  centerLabel="collected"
/>
```

- Segments render in order, clockwise from 12 o'clock.
- A zero total renders an empty ring plus the centre text — never `NaN`.
- Hovering a segment raises it and dims the rest; the hovered segment's label and
  value replace the centre text.

### `MetricBars`

Labelled rows with a proportional bar — the readable half of the panel.

```tsx
<MetricBars
  rows={[
    { label: 'Present',   value: 412, color: '#10b981', href: '#student-present' },
    { label: 'Absent',    value:  23, color: '#ef4444' },
    { label: 'Irregular', value:   9, color: '#f59e0b' },
  ]}
  format={(v) => v.toLocaleString('en-IN')}
  showPercent
/>
```

- Bars are proportional to the row set's total (or `max` when passed).
- Rows are `<a>` when `href` is given, `<div>` otherwise; hover tints the row.

### `LineChart` (existing)

For trends over time (collection by month, attendance by week). Keep to one
series per idea; two at most.

## Colour semantics

Fixed across the app so a colour means the same thing on every panel:

| Meaning | Colour | Hex |
|---|---|---|
| good / collected / present / paid | emerald | `#10b981` |
| warning / irregular / partial / pending | amber | `#f59e0b` |
| bad / absent / overdue / unpaid | red | `#ef4444` |
| neutral / total / informational | sky | `#0ea5e9` |
| secondary scope (staff vs students, bus vs school) | violet | `#8b5cf6` |

Never encode meaning by colour alone — every segment carries a text label too.

## Accessibility

- `role="img"` plus an `aria-label` summarising the chart in words on each SVG.
- Interactive segments are `<a>`/`<button>` with focus rings; hover-only detail
  must also appear on focus.
- Charts must read correctly with `prefers-reduced-motion` (no entrance animation
  that is required to see the data).
