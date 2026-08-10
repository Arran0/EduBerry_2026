# Component recipes

Copy-paste starting points. All use the primitives in `globals.css`.

## Buttons

Replaces `.btn-primary` / `.btn-secondary`. Flat fill, no gradient, no colored
glow — the accent color alone carries the emphasis.

```jsx
// Primary — one per view
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

// Secondary — tinted, low saturation
<button
  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl
             text-sm font-semibold pressable
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
             focus-visible:ring-[var(--page-primary)]"
  style={{ background: 'var(--page-primary-light)', color: 'var(--page-primary-dark)' }}
>
  Preview
</button>

// Tertiary / ghost
<button className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl
                   text-sm font-medium text-slate-600 hover:bg-slate-100 pressable">
  Cancel
</button>

// Destructive — confirm before firing
<button className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl
                   bg-rose-600 text-white text-sm font-semibold pressable">
  Delete
</button>

// Icon-only — aria-label is required
<button aria-label="Close" className="grid place-items-center w-11 h-11 rounded-full
                                      text-slate-600 hover:bg-slate-100 pressable">
  <X className="w-5 h-5" />
</button>
```

`min-h-[44px]` is the touch-target floor. `.glass-btn` remains valid for compact
action rows over a photo or colored surface, but give it a larger tap area.

## Card

```jsx
<div className="glass-card pressable rounded-2xl p-4 sm:p-6">
  <div className="flex items-start gap-3">
    <div className="icon-chip w-10 h-10 shrink-0"
         style={{ background: 'var(--page-primary)' }}>
      <BookOpen className="w-5 h-5 text-white" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="eyebrow text-slate-400 mb-1">Mathematics</p>
      <h3 className="text-base font-semibold text-slate-900 truncate">Algebra — Chapter 4</h3>
      <p className="text-sm text-slate-600 leading-relaxed mt-1">Due Friday, 12 sections remaining.</p>
    </div>
  </div>
</div>
```

`min-w-0` on the flex child is what makes `truncate` actually work — without it
long names blow out the layout on phones.

## List row

Prefer lists over tables on phones — a horizontally scrolling table is a failure
state on a 390px screen.

```jsx
<button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                   text-left hover:bg-slate-50 pressable">
  <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
  <div className="min-w-0 flex-1">
    <p className="text-sm font-medium text-slate-900 truncate">Ananya Sharma</p>
    <p className="text-xs text-slate-500 truncate">Class 9-B · Roll 24</p>
  </div>
  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
</button>
```

## Status badge

Icon plus label — never color alone.

```jsx
<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                 bg-emerald-50 text-emerald-700 text-xs font-medium">
  <CheckCircle2 className="w-3.5 h-3.5" />
  Approved
</span>
```

## Form field

```jsx
<div className="space-y-1.5">
  <label htmlFor="email" className="block text-sm font-medium text-slate-900">
    Email address
  </label>
  <input
    id="email"
    type="email"
    aria-describedby={error ? 'email-error' : undefined}
    aria-invalid={!!error}
    className={`input-field ${error ? 'border-rose-400 focus:ring-rose-500/50' : ''}`}
    placeholder="name@school.edu"
  />
  {error && (
    <p id="email-error" role="alert" className="flex items-center gap-1.5 text-xs text-rose-600">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      {error}
    </p>
  )}
</div>
```

Errors go below the field, are announced with `role="alert"`, and are tied to the
input via `aria-describedby`. Never rely on a red border alone.

## Table (desktop)

```jsx
<div className="glass-card rounded-2xl overflow-hidden">
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b border-slate-200/70">
        <th className="text-left font-medium text-slate-500 px-4 py-3">Student</th>
        <th className="text-right font-medium text-slate-500 px-4 py-3">Marks</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-200/70">
      <tr className="hover:bg-slate-50/70 transition-colors">
        <td className="px-4 py-3 text-slate-900">Ananya Sharma</td>
        <td className="px-4 py-3 text-right text-slate-900 tabular-nums font-medium">92</td>
      </tr>
    </tbody>
  </table>
</div>
```

Numbers right-aligned and `tabular-nums`. Text left-aligned. Header labels are
`text-slate-500 font-medium` — quieter than the data, since the data is the point.

## Empty state

Every list needs one. An empty screen with no explanation reads as a bug.

```jsx
<div className="flex flex-col items-center justify-center py-16 px-6 text-center">
  <div className="grid place-items-center w-14 h-14 rounded-2xl bg-slate-100 mb-4">
    <Inbox className="w-7 h-7 text-slate-400" />
  </div>
  <h3 className="text-base font-semibold text-slate-900">No announcements yet</h3>
  <p className="text-sm text-slate-600 mt-1 max-w-xs">
    When your school posts an update, it will appear here.
  </p>
  <button className="mt-5 min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white pressable"
          style={{ background: 'var(--page-primary)' }}>
    Create announcement
  </button>
</div>
```

## Loading — skeletons, not spinners

Skeletons preserve layout and reduce perceived latency. Spinners are for actions
inside a button, not for page loads.

```jsx
<div className="glass-card rounded-2xl p-4 sm:p-6">
  <div className="animate-pulse flex items-start gap-3">
    <div className="w-10 h-10 rounded-xl bg-slate-200 shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3 w-1/3 rounded bg-slate-200" />
      <div className="h-3 w-2/3 rounded bg-slate-200" />
    </div>
  </div>
</div>
```

Match the skeleton's shape to the real content, or the swap-in jumps.

## Modal

Always `ModalShell`. It handles the phone sheet, drag-to-dismiss, safe areas and
the desktop dialog.

```jsx
<AnimatePresence>
  {open && (
    <ModalShell
      onClose={() => setOpen(false)}
      size="md"
      title="Apply for leave"
      subtitle="Your class teacher will be notified"
      icon={<CalendarDays className="w-5 h-5" />}
      iconClassName="bg-violet-100 text-violet-600"
      footer={
        <div className="flex gap-2 justify-end">
          <button className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button className="min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white pressable"
                  style={{ background: 'var(--page-primary)' }}>
            Submit
          </button>
        </div>
      }
    >
      {/* body */}
    </ModalShell>
  )}
</AnimatePresence>
```

The `AnimatePresence` wrapper is required or the exit animation is skipped.

## Page shell

```jsx
<div data-page-theme="tasks" className="min-h-dvh bg-slate-50">
  <header className="glass sticky top-0 z-20 border-b border-slate-200/70">
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-3">
      <h1 className="text-base font-semibold text-slate-900">Tasks</h1>
    </div>
  </header>

  <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
    <section className="space-y-3">
      <div>
        <p className="eyebrow text-slate-400">This week</p>
        <h2 className="text-2xl font-semibold headline text-slate-900">Assigned to you</h2>
      </div>
      {/* cards */}
    </section>
  </main>
</div>
```

`min-h-dvh` not `min-h-screen` — `dvh` accounts for mobile browser chrome.
Sticky headers use `.glass` so content blurs beneath them as it scrolls.
