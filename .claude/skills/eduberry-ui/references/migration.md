# Migration

Two design layers currently coexist: the legacy gradient layer and the premium
primitive layer. Converging on one is what makes the product feel coherent.

## Current state

Measured across `src/**/*.tsx` (file counts, refresh with the command below):

| Deprecated | Files | Replacement |
|---|---|---|
| `btn-primary` | 28 | Primary button recipe |
| `btn-secondary` | 10 | Secondary button recipe |
| `gradient-text` | 1 | `.headline` + `text-slate-900` |
| `mesh-bg` | 1 | `bg-slate-50` |
| `card-hover` | 1 | `.pressable` |
| `gradient-border` | 0 | Delete the CSS rule |

| Adopted | Files |
|---|---|
| `glass-card` | 14 |
| `icon-chip` | 11 |
| `headline` | 9 |
| `eyebrow` | 6 |
| `pressable` | 1 |

```bash
for c in gradient-text mesh-bg gradient-border btn-primary btn-secondary card-hover \
         glass-card pressable icon-chip headline eyebrow; do
  printf "%-16s %s\n" "$c" "$(grep -rl "\b$c\b" src --include=*.tsx | wc -l)"
done
```

`pressable` at 1 file against `glass-card` at 14 is the clearest gap — most cards
are static when they should respond to touch.

## Strategy: opportunistic, not a big bang

Do **not** open a 28-file pull request that restyles every button. It is
unreviewable, it will collide with feature work, and a visual regression hides
easily in that much diff.

Instead: when you touch a file for any reason, migrate the deprecated classes in
that file. Ship it with the feature change. The count drops steadily and every
change stays reviewable.

Exceptions worth a dedicated PR:
- `gradient-border` — zero usages, delete the rule outright.
- `gradient-text`, `mesh-bg`, `card-hover` — one file each, trivial together.

## Order of work

1. **Delete dead CSS.** `gradient-border` has no usages. Remove the rule and its
   `gradientMove` keyframes.
2. **Sweep the three one-file classes.** One small PR, easy to eyeball.
3. **Adopt `.pressable` on interactive cards.** Highest perceived-quality gain
   for the effort — tap feedback is most of what makes an app feel native.
4. **Migrate buttons opportunistically.** The long tail. Track the count down.
5. **Neutralize page-theme backgrounds.** See below.

## Retiring the gradient page backgrounds

`globals.css` has ~15 rules shaped like:

```css
body:has([data-page-theme="home"]) { background: linear-gradient(135deg, #e0f2fe, #f0fdf4, #dcfce7); }
```

These wash the whole page in color, which lowers text contrast, muddies glass
materials, and makes every screen feel like a different product.

Keep the `[data-page-theme]` custom-property blocks — the accent system is good
and worth keeping. Remove only the `body:has(...)` background rules, then set
`bg-slate-50` on page containers.

Do this **one theme at a time**, checking the affected screens. Some pages may
rely on the wash for contrast against white cards; those need `bg-slate-50` added
before the gradient comes out, or cards will vanish into the background.

## Button migration example

```jsx
// Before
<button className="btn-primary">Save changes</button>

// After
<button
  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl
             text-sm font-semibold text-white pressable
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
             focus-visible:ring-[var(--page-primary)]
             disabled:opacity-40 disabled:pointer-events-none"
  style={{ background: 'var(--page-primary)' }}
>
  Save changes
</button>
```

If a file has many buttons, extract a local `<Button>` component rather than
repeating the class string. A shared `src/components/ui/Button.tsx` is the right
end state — `ModalShell` already proves the shared-primitive pattern works here.

## Verifying a migration

`npm run build` catches nothing visual. Check the real screens:

```bash
npm run dev
playwright-cli open http://localhost:8081/tasks
playwright-cli screenshot --full-page tasks-after.png
```

Compare against a screenshot taken before the change. Check both a 390px phone
viewport and desktop — this app is used mostly on phones.
