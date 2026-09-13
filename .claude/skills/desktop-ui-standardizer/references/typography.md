# Desktop typography

Desktop type is a separate hierarchy, not the mobile ramp multiplied by 1.3.
Mobile needs large type because the column is 360px wide; desktop needs
*contrast between levels* because there is far more on screen at once.

## The desktop ramp

| Role | Desktop | Mobile | Notes |
|---|---|---|---|
| page title | `text-[2rem]` / `2.6rem` hero | `text-[2rem]` | `.headline` (tight tracking), `font-display` |
| section title | `text-[1.15rem] lg:text-[1.25rem]` | `text-[1.4rem]` | section titles get *smaller* on desktop — there are more of them visible |
| panel title | `text-sm font-semibold` | `text-base` | |
| body | `text-sm` (14px) | `text-sm`/`text-base` | |
| dense table cell | `text-[13px]` | — | with `tabular-nums` for numbers |
| metric value | `text-2xl lg:text-3xl font-black tabular-nums` | `text-xl` | the one place desktop goes bigger |
| label / metadata | `text-[11px] lg:text-xs text-slate-500` | `text-[9.5px]` | never below 11px on desktop |
| eyebrow / kicker | `.eyebrow` (uppercase, tracked, 10–11px, slate-400) | same | |

Key moves:

- **Section headings shrink, metric values grow.** A desktop dashboard shows six
  section titles at once; 1.4rem each turns the page into a list of shouting
  headers. The numbers are the content — let them carry the size.
- **Nothing below 11px.** The 9.5px tile labels that work at arm's length on a
  phone are illegible at 60cm on a 27" monitor: `text-[9.5px] lg:text-[11px]`.
- **Weight does the work, not size.** `font-semibold` content against
  `font-medium text-slate-500` metadata separates levels without a size jump.

## Subordination

Labels, units, timestamps and helper text must be visually subordinate:

- colour: `text-slate-400`/`text-slate-500` against `text-slate-800`/`900`
- weight: `font-medium` against `font-semibold`/`font-bold`
- size: one step down, not two

If a label and its value look equally important, the label is wrong.

## Line length and rhythm

- Long-form content (announcements, descriptions, policies): `max-w-[70ch]`.
  Never let prose run the full 1600px of a dashboard container.
- `leading-relaxed` for prose, `leading-tight`/`leading-none` for numbers and
  labels in dense panels.
- Truncate with purpose: `truncate` for single-line titles in rows,
  `line-clamp-2` for card titles. Give the full text a `title` attribute.

## Numerals

- Always `tabular-nums` for anything in a column or that updates live — otherwise
  numbers jitter as they change.
- Abbreviate in tiles (`₹1.2L`, `12.4K`) but expose the exact value via `title`.
- Currency and units in the subordinate style, never at the value's weight.
