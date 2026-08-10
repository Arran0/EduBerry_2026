---
name: eduberry-ui
description: EduBerry's design language — an Apple-inspired system of materials, type, depth and motion built on Tailwind + globals.css. Use whenever building, restyling, or reviewing any UI in this repo: pages, cards, modals, forms, buttons, tables, empty states, navigation. Triggers on "make this look better", "build a page/screen/card/modal", "restyle", "design review", "make it consistent", or any work touching src/components or src/app that renders markup.
---

# EduBerry Design Language

An Apple-inspired system. The goal is that every screen in this product looks
like it came from the same team on the same day.

## The three principles

Apple's HIG rests on clarity, deference, and depth. Translated to this codebase:

1. **Clarity** — Content is the interface. Text is legible at every size, icons
   are precise, negative space is generous. Decoration never competes with data.
2. **Deference** — The chrome recedes. Materials are translucent and neutral so
   the *content* carries the color. A screen full of student names should be
   mostly white space and typography, not gradients.
3. **Depth** — Hierarchy is communicated by layering and motion, not by borders
   and boxes. Things that sit above other things cast soft, large-radius shadows.

The single most common mistake in this repo is **decorating instead of
organizing**. When a screen feels flat or cheap, the fix is almost always more
whitespace and better type hierarchy — not another gradient.

## Use the primitives, always

`src/app/globals.css` already contains a tuned primitive layer. Compose these
rather than writing bespoke `bg-white/60 backdrop-blur-xl border ...` chains.
Ad-hoc glass will never quite match, and mismatch is what makes a UI feel
amateur.

| Primitive | Use for |
|---|---|
| `.glass-card` | The canonical raised surface. Cards, panels, sheets. |
| `.glass-tile` | Lighter inline material. Dock items, app pills, chips. |
| `.glass` / `.glass-strong` | Bars and overlays that sit over scrolling content. |
| `.pressable` | Anything tappable. Gives the hover lift + tap-scale. |
| `.icon-chip` | The rounded-square icon badge beside a title. |
| `.eyebrow` | Small uppercase kicker above a section title. |
| `.headline` | Large display type — applies the optical tracking. |
| `.sheen` + `.sheen-animate` | A one-time specular sweep. Hero surfaces only. |
| `.input-field` | All text inputs. Never restyle an input inline. |

`ModalShell` (`src/components/ui/ModalShell.tsx`) is the **only** way to build a
popup. It handles the phone bottom-sheet, drag-to-dismiss, safe areas, focus and
the desktop dialog. Do not hand-roll a fixed-position overlay.

## Deprecated — do not use in new code

These predate the design language and actively fight it. Do not add new usages;
remove them opportunistically when you touch a file (see `references/migration.md`).

- `.gradient-text` — gradient-filled text. Use `.headline` with a solid ink color.
- `.mesh-bg` — the eight-stop radial mesh. Use a plain neutral ground.
- `.gradient-border` — the infinitely animating border. Perpetual motion with no
  state change is noise; use `.glass-card`'s shadow for emphasis.
- `.btn-primary` / `.btn-secondary` — two-stop gradient fills with colored glow
  shadows. Use the button recipes in `references/components.md`.
- `.card-hover` — superseded by `.pressable`.

## Color

**Neutrals carry the UI; color carries meaning.** A view should read as ink on
white with one accent. Color is reserved for: the primary action, the selected
state, and semantic status (success / warning / danger / info).

- Ink: `text-slate-900` (primary), `text-slate-600` (secondary), `text-slate-400`
  (tertiary/placeholder). Three levels — do not invent a fourth.
- Ground: `#ffffff` or `bg-slate-50`. Never a gradient behind reading content.
- Accent: `var(--page-primary)`, set by the page theme.

The `[data-page-theme]` system defines 15 palettes. **It sets the accent, not the
background.** The `body:has(...)` gradient-background rules are legacy — a
gradient wash behind a data table lowers contrast and makes glass materials muddy.
New pages set a page theme for the accent and keep a neutral ground.

Full ramps, semantic colors, and contrast rules: `references/tokens.md`.

## Type

Poppins is the shipped family. It is geometric where SF is humanist, so it needs
**tighter tracking and lower weights** than you would use otherwise to read as
Apple-like.

| Role | Classes |
|---|---|
| Display | `text-3xl sm:text-4xl font-bold headline text-slate-900` |
| Title | `text-xl font-semibold headline text-slate-900` |
| Section | `text-base font-semibold text-slate-900` |
| Body | `text-sm text-slate-600 leading-relaxed` |
| Caption | `text-xs text-slate-500` |
| Eyebrow | `eyebrow text-slate-400` |

Rules: never go below `text-xs` for anything a user must read. Never use
`font-black`. Apply `.headline` to anything `text-2xl` and above — large
geometric type without negative tracking looks loose and unfinished.

## Space and shape

Spacing follows a 4pt grid: `1, 1.5, 2, 3, 4, 6, 8, 12, 16`. Avoid arbitrary
values like `p-[13px]`.

Radii are **nested** — an inner element's radius must be smaller than its
container's, or corners look wrong:

| Element | Radius |
|---|---|
| Sheet / modal | `rounded-3xl` (24px) |
| Card | `rounded-2xl` (16px) |
| Input / button | `rounded-xl` (12px) |
| Chip / pill | `rounded-full` |

Touch targets are **44×44px minimum** — an Apple hard rule, and this app is used
on phones by students. `py-1.5 text-xs` buttons need padding or a larger hit area.

## Motion

Motion explains change. It never decorates.

- Standard easing: `cubic-bezier(0.2, 0.9, 0.25, 1)` — the `.pressable` curve.
- Durations: 90ms (tap), 220ms (hover/state), 300–400ms (sheet/modal).
- `framer-motion` springs for anything that enters: `{ type: 'spring', stiffness: 380, damping: 32 }`.
- Every entrance needs a matching exit. Wrap in `AnimatePresence`.
- Honor `prefers-reduced-motion` — the primitives already do; custom animations must too.

No infinite animation unless it reports live state (a spinner, a sync indicator).

## Accessibility is part of the design, not a later pass

- Body text ≥ 4.5:1 contrast. `text-slate-400` on white fails — it is for
  placeholders and disabled states only, never for content.
- Never encode meaning in color alone; pair status colors with an icon or label.
- Visible focus rings: `focus-visible:ring-2 focus-visible:ring-[var(--page-primary)] focus-visible:ring-offset-2`.
- Icon-only buttons require `aria-label`.
- Glass over a busy background can drop text contrast below threshold — check.

## Before you finish

Run this against any screen you built or touched:

- [ ] Composed primitives instead of ad-hoc glass classes
- [ ] No deprecated classes added
- [ ] Three ink levels, one accent, semantic color only for status
- [ ] `.headline` on display type; nothing below `text-xs`
- [ ] Radii nested correctly; 4pt spacing
- [ ] Touch targets ≥ 44px
- [ ] Focus rings visible; icon buttons labeled
- [ ] Entrances have exits; reduced-motion honored
- [ ] Empty, loading, and error states designed — not just the happy path

## References

- `references/tokens.md` — color ramps, semantic colors, elevation, full type scale
- `references/components.md` — copy-paste recipes for button, card, list row, table, form field, empty state, toast
- `references/migration.md` — how to retire deprecated classes safely
