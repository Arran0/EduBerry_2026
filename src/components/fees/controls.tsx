'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The fee module's three shared filter controls.
//
// They live together because they are read together — one toolbar over the bill
// ledger — and because each one is the kind of control that gets re-invented
// slightly differently every time it is written inline.
//
//   DateRangeBar  Today · Yesterday · All · Custom, on one line whatever the
//                 window is doing. It scrolls sideways rather than wrapping:
//                 a segmented control that reflows to two rows stops reading
//                 as one control.
//   MultiSelect   A dropdown of checkboxes. Nothing is "the one selected
//                 thing" — an empty set means everything, which is what a
//                 filter with no opinion should mean.
//   StudentPicker A type-ahead over a roster already in memory, used wherever
//                 somebody has to name a student.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { ADMIN } from '@/components/fees/ui'
import { gradeLabel } from '@/lib/grades'
import { rangeFor, todayISO, type DateRange, type RangeKey } from '@/lib/fees/ledger'

// ── Dates ────────────────────────────────────────────────────────────────

const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

/**
 * The range picker. The four buttons are always on one line — `flex-nowrap`
 * with a sideways scroll — and the two date boxes drop onto their own line
 * under it only once Custom is chosen.
 */
export function DateRangeBar({
  value, onChange, label,
}: {
  value: DateRange
  onChange: (r: DateRange) => void
  /** What the dates are about, e.g. "Issued". Rendered as a leading caption. */
  label?: string
}) {
  const pick = (key: RangeKey) => {
    if (key === 'custom') {
      onChange({ key: 'custom', from: value.from ?? todayISO(-7), to: value.to ?? todayISO() })
    } else {
      onChange(rangeFor(key))
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {label && (
          <span className={`${ADMIN.label} flex-shrink-0 hidden sm:inline`}>{label}</span>
        )}
        <div className="flex flex-nowrap overflow-x-auto no-scrollbar border border-[#E3DFD3] bg-white">
          {RANGE_TABS.map(t => {
            const on = t.key === value.key
            return (
              <button
                key={t.key}
                onClick={() => pick(t.key)}
                className={`flex-shrink-0 whitespace-nowrap px-2.5 py-[7px] text-[10.5px] font-bold
                            uppercase tracking-[0.08em] leading-none border-r border-[#E3DFD3]
                            last:border-r-0 transition-colors ${
                  on ? 'bg-[#27272A] text-white' : 'text-[#6B675A] hover:text-[#18181B] hover:bg-[#FAF8F2]'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {value.key === 'custom' && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input
            type="date" value={value.from ?? ''} max={value.to ?? undefined}
            onChange={e => onChange({ ...value, key: 'custom', from: e.target.value || null })}
            aria-label="From"
            className="bg-white border border-[#E3DFD3] px-2 py-1 text-[11.5px] text-[#18181B]
                       focus:outline-none focus:border-[#27272A]"
          />
          <span className="text-[11px] text-[#8C8878]">to</span>
          <input
            type="date" value={value.to ?? ''} min={value.from ?? undefined}
            onChange={e => onChange({ ...value, key: 'custom', to: e.target.value || null })}
            aria-label="To"
            className="bg-white border border-[#E3DFD3] px-2 py-1 text-[11.5px] text-[#18181B]
                       focus:outline-none focus:border-[#27272A]"
          />
        </div>
      )}
    </div>
  )
}

// ── Multi-select ─────────────────────────────────────────────────────────

export interface Option<T extends string> { key: T; label: string }

/**
 * A dropdown of checkboxes.
 *
 * An empty selection is "everything", not "nothing": a bill ledger with no
 * status ticked should show every bill, because that is what the reader means
 * by not having chosen. The button says so, rather than reading "0 selected".
 */
export function MultiSelect<T extends string>({
  label, options, selected, onChange, allLabel,
}: {
  label: string
  options: Option<T>[]
  selected: Set<T>
  onChange: (next: Set<T>) => void
  /** What an empty selection is called. Defaults to "All". */
  allLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const toggle = (key: T) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key); else next.add(key)
    onChange(next)
  }

  const summary = selected.size === 0
    ? (allLabel ?? 'All')
    : selected.size === 1
      ? options.find(o => selected.has(o.key))?.label ?? `${selected.size}`
      : `${selected.size} picked`

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 bg-white border px-2.5 py-[7px] text-[10.5px]
                    font-bold uppercase tracking-[0.08em] leading-none whitespace-nowrap
                    transition-colors ${
          selected.size > 0
            ? 'border-[#B8983C] text-[#18181B]'
            : 'border-[#E3DFD3] text-[#6B675A] hover:text-[#18181B] hover:border-[#C9C4B4]'
        }`}
      >
        <span className="text-[#8C8878] font-bold">{label}</span>
        <span>{summary}</span>
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 min-w-[190px] bg-white border border-[#E3DFD3] shadow-sm">
          {options.map(o => {
            const on = selected.has(o.key)
            return (
              <button
                key={o.key}
                onClick={() => toggle(o.key)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[12px]
                           text-[#18181B] hover:bg-[#FAF8F2] border-b border-[#F0ECE2] last:border-0"
              >
                <span className={`w-3.5 h-3.5 border flex items-center justify-center flex-shrink-0 ${
                  on ? 'bg-[#27272A] border-[#27272A] text-white' : 'border-[#C9C4B4]'}`}>
                  {on && <Check size={10} strokeWidth={3} />}
                </span>
                {o.label}
              </button>
            )
          })}
          {selected.size > 0 && (
            <button
              onClick={() => onChange(new Set())}
              className="w-full px-2.5 py-1.5 text-left text-[10.5px] font-bold uppercase
                         tracking-[0.08em] text-[#8C8878] hover:text-[#A93232] bg-[#FAF8F2]"
            >
              <X size={11} className="inline -mt-px mr-1" /> Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Student type-ahead ───────────────────────────────────────────────────

export interface PickableStudent {
  student_id: string
  full_name: string
  grade: number | null
  section: string | null
  admission_no?: string | null
}

/**
 * Type a name, pick a student.
 *
 * The roster is already in memory everywhere this is used, so the matching is
 * done here rather than in a query per keystroke. `exclude` keeps people who
 * are already on the list out of the suggestions, which is what stops somebody
 * adding the same child twice and wondering why nothing happened.
 */
export function StudentPicker({
  people, onPick, exclude, placeholder = 'Type a name or admission number', autoFocus,
}: {
  people: PickableStudent[]
  onPick: (s: PickableStudent) => void
  exclude?: Set<string>
  placeholder?: string
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 1) return []
    return people
      .filter(p => !exclude?.has(p.student_id))
      .filter(p => p.full_name.toLowerCase().includes(q)
        || (p.admission_no ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [people, query, exclude])

  return (
    <div className="relative">
      <Search size={13} className="absolute left-2.5 top-[11px] text-[#A8A395] pointer-events-none" />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`${ADMIN.inputPlain} pl-[30px]`}
      />
      {matches.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-0.5 bg-white border border-[#E3DFD3] shadow-sm">
          {matches.map(p => (
            <button
              key={p.student_id}
              onClick={() => { onPick(p); setQuery('') }}
              className="w-full text-left px-2.5 py-2 text-[12.5px] text-[#18181B] hover:bg-[#FAF8F2]
                         border-b border-[#F0ECE2] last:border-0"
            >
              {p.full_name}
              <span className="text-[#8C8878]">
                {' · '}{gradeLabel(p.grade) || '—'}{p.section ?? ''}
                {p.admission_no ? ` · ${p.admission_no}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      {query.trim().length > 0 && matches.length === 0 && (
        <p className="absolute z-30 left-0 right-0 mt-0.5 bg-white border border-[#E3DFD3]
                      px-2.5 py-2 text-[11.5px] text-[#8C8878]">
          Nobody matches that.
        </p>
      )}
    </div>
  )
}
