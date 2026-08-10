# Tokens

## Ink (text)

Three levels. Resist adding a fourth — ambiguity in type hierarchy is what makes
a screen look unconsidered.

| Level | Class | Use |
|---|---|---|
| Primary | `text-slate-900` | Headings, values, names, anything scanned |
| Secondary | `text-slate-600` | Body copy, descriptions, labels |
| Tertiary | `text-slate-400` | Placeholders, disabled, decorative icons |

`text-slate-400` on white is ~2.8:1 — below the 4.5:1 body-text threshold. It is
legitimate for placeholder and disabled text (exempt under WCAG 1.4.3) and
illegitimate for content. If a caption matters, it is `text-slate-500` or darker.

## Ground (backgrounds)

| Token | Value | Use |
|---|---|---|
| Base | `#ffffff` | Default page ground |
| Sunken | `bg-slate-50` | Behind cards, to make them read as raised |
| Raised | `.glass-card` | The card itself |
| Hairline | `border-slate-200/70` | Dividers; prefer over full borders |

Do not put a gradient behind reading content. Gradients belong on marketing
surfaces and hero headers, not dashboards, tables, or forms.

## Accent

Read from the page theme rather than hard-coding:

```jsx
style={{ color: 'var(--page-primary)' }}
style={{ background: 'var(--page-primary)' }}
```

Available: `--page-primary`, `--page-primary-light`, `--page-primary-dark`,
`--page-accent`, `--page-accent-light`.

Set the theme on the page's outermost element:

```jsx
<div data-page-theme="tasks"> ... </div>
```

Themes defined in `globals.css`: `home`, `announcements`, `tasks`, `academics`,
`attendance`, `classrooms`, `exam`, `fees`, `leave`, `salary`, `bus`,
`certificates`, `settings`, `timetable`, `workspace`.

Use `--page-primary-light` for selected-row and badge backgrounds — it is the
tinted, low-saturation companion, which is how Apple signals selection.

## Semantic color

Meaning, never decoration. Always pair with an icon or text label.

| Status | Text | Background | Icon (lucide) |
|---|---|---|---|
| Success | `text-emerald-700` | `bg-emerald-50` | `CheckCircle2` |
| Warning | `text-amber-700` | `bg-amber-50` | `AlertTriangle` |
| Danger | `text-rose-700` | `bg-rose-50` | `AlertCircle` |
| Info | `text-sky-700` | `bg-sky-50` | `Info` |
| Neutral | `text-slate-600` | `bg-slate-100` | `Circle` |

The `-700` text on `-50` background pairing clears 4.5:1 in every row above.

## Elevation

Depth comes from large-radius, low-opacity shadows — never from heavy borders.
Shadows are cool-tinted (`rgba(15, 23, 42, …)`), not neutral black; black
shadows read as dirt over a colored ground.

| Level | Shadow | Use |
|---|---|---|
| 0 — Flush | none | Content on ground |
| 1 — Raised | `0 1px 2px rgba(15,23,42,.05), inset 0 1px 0 rgba(255,255,255,.6)` | `.glass-tile` |
| 2 — Card | `0 1px 1px rgba(15,23,42,.035), 0 10px 30px -12px rgba(15,23,42,.16)` | `.glass-card` |
| 3 — Lifted | `0 18px 40px -16px rgba(15,23,42,.24)` | `.pressable:hover` |
| 4 — Modal | `0 30px 60px -20px rgba(15,23,42,.35)` | Sheets, dialogs |

The `inset 0 1px 0 rgba(255,255,255,…)` top highlight is what makes a surface
look like a physical material rather than a flat rectangle. Keep it when you
write a custom surface.

## Type scale

| Role | Size | Weight | Extra |
|---|---|---|---|
| Display L | `text-4xl` | `font-bold` | `.headline` |
| Display | `text-3xl` | `font-bold` | `.headline` |
| Title L | `text-2xl` | `font-semibold` | `.headline` |
| Title | `text-xl` | `font-semibold` | `.headline` |
| Section | `text-base` | `font-semibold` | — |
| Body | `text-sm` | `font-normal` | `leading-relaxed` |
| Label | `text-sm` | `font-medium` | — |
| Caption | `text-xs` | `font-normal` | `text-slate-500` |
| Eyebrow | 10px | `font-extrabold` | `.eyebrow` |

Numerals in tables, currency, and IDs get `tabular-nums` so columns align:

```jsx
<span className="tabular-nums text-slate-900 font-medium">₹{amount}</span>
```

`Caveat` is loaded for signature/handwriting contexts only (certificates).
Never use it for UI chrome.

## Spacing

4pt grid: `p-1 p-1.5 p-2 p-3 p-4 p-6 p-8 p-12 p-16`.

| Context | Value |
|---|---|
| Icon ↔ label | `gap-2` |
| Within a group | `gap-3` |
| Card padding | `p-4` mobile, `sm:p-6` desktop |
| Between cards | `gap-4` |
| Between sections | `gap-8` / `mt-8` |
| Page gutter | `px-4 sm:px-6 lg:px-8` |

Generous whitespace is the cheapest way to look premium. When a layout feels
cramped, increase spacing before shrinking type.

## Radii

Nesting rule: inner radius < outer radius, or the corners look visually wrong.

| Element | Class |
|---|---|
| Sheet / modal | `rounded-3xl` |
| Card / panel | `rounded-2xl` |
| Input / button / tile | `rounded-xl` |
| Small chip | `rounded-lg` |
| Pill / avatar | `rounded-full` |

A `rounded-2xl` card containing a `rounded-2xl` input is the most common radius
mistake here — the input should be `rounded-xl`.

## Safe areas and keyboard

The app runs as a PWA on phones. Bottom-anchored UI must respect insets:

```jsx
style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
```

`--keyboard-inset` and `--keyboard-anchor` (written by `useKeyboardInset`) give
live soft-keyboard geometry — use them for compose bars and sticky footers
rather than guessing.
