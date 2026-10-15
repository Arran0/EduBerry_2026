'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The grid: every grade down the side, every term (and its term-wise heads),
// then the monthly heads, then "Other" across the top. A cell is one price.
// A head that differs for boys and girls gets a double cell.
//
// It is content, not chrome — solid white, hairlines, tabular figures — so it
// reads like a ledger. Only the sticky header is glass, because it floats over
// the rows as they scroll beneath it.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Lock, Plus, Users } from 'lucide-react'
import { gradeLabel } from '@/lib/grades'
import {
  NO_GRADE_LABEL, gridRows, indexLocks, indexRates, lockKey, rateKey, rowId,
  type ChargeRow, type Gender, type GridRowKey, type GroupRow, type HeadRow,
  type IssueCellRow, type IssueRow, type RateEdit, type RateRow, type StudentLite, type TermRow,
} from '@/lib/fees/grid'
import { SYS, shortDate } from './glass'
import type { IssueScope } from './IssuePanel'

const BOY = '#0A84FF'
const GIRL = '#FF2D55'

interface Column {
  key: string
  head: HeadRow
  termId: string | null
  /** Index of the band (term / monthly) the column sits in, for zebra banding. */
  band: number
}

export default function FeeGrid({
  terms, heads, groups, rates, cells, charges, issues, students, scope, canEdit,
  onCommit, onAddGroup, onEditGroup, onOpenCharge, onEditTerm, onEditHead,
}: {
  terms: TermRow[]
  heads: HeadRow[]
  groups: GroupRow[]
  rates: RateRow[]
  cells: IssueCellRow[]
  charges: ChargeRow[]
  issues: IssueRow[]
  students: StudentLite[]
  scope: IssueScope | null
  canEdit: boolean
  onCommit: (edit: RateEdit) => Promise<void>
  onAddGroup: (grade: number) => void
  onEditGroup: (g: GroupRow) => void
  onOpenCharge: (c: ChargeRow) => void
  onEditTerm: (t: TermRow) => void
  onEditHead: (h: HeadRow) => void
}) {
  const termHeads = heads.filter(h => h.active && h.frequency === 'term')
  const monthHeads = heads.filter(h => h.active && h.frequency === 'monthly')
  const rows = useMemo(() => gridRows(groups), [groups])
  const rateIx = useMemo(() => indexRates(rates), [rates])
  const lockIx = useMemo(() => indexLocks(cells), [cells])
  const issuedCharge = useMemo(
    () => new Set(issues.filter(i => i.status === 'issued' && i.charge_id).map(i => i.charge_id as string)), [issues])

  const columns: Column[] = []
  terms.forEach((t, i) => termHeads.forEach(h => columns.push({ key: `${t.id}:${h.id}`, head: h, termId: t.id, band: i })))
  monthHeads.forEach(h => columns.push({ key: `m:${h.id}`, head: h, termId: null, band: terms.length }))

  // Students per row, so a price is never set blind.
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    const sec = (s: StudentLite) => (s.section ?? '').trim().toUpperCase()
    for (const s of students) {
      let key: string
      if (s.grade === null) key = rowId({ grade: null, group_id: null })
      else {
        const g = groups.find(x => x.grade === s.grade && x.sections.includes(sec(s)))
        key = rowId({ grade: s.grade, group_id: g?.id ?? null })
      }
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [students, groups])

  // "Other" chips: a charge shows in every grade row its students come from.
  const chargesByRow = useMemo(() => {
    const m = new Map<string, ChargeRow[]>()
    for (const c of charges) {
      const grades = new Set(c.students.map(s => s.grade))
      grades.forEach(g => {
        const key = rowId({ grade: g, group_id: null })
        m.set(key, [...(m.get(key) ?? []), c])
      })
    }
    return m
  }, [charges])

  const inScope = (row: GridRowKey, col: Column) => {
    if (!scope) return false
    if (scope.mode === 'term' ? col.termId !== scope.termId : col.termId !== null) return false
    if (scope.headIds.size && !scope.headIds.has(col.head.id)) return false
    if (scope.rowIds.size && !scope.rowIds.has(rowId(row))) return false
    return true
  }

  const tableRef = useRef<HTMLTableElement>(null)
  const focusCell = (r: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)
    if (el) { el.focus(); el.select() }
  }

  if (terms.length === 0 && heads.length === 0) {
    return (
      <div className="rounded-[20px] bg-white ring-1 ring-black/[0.04] px-6 py-14 text-center">
        <div className="mx-auto w-12 h-12 rounded-[14px] flex items-center justify-center text-white mb-3" style={{ background: SYS.blue }}>
          <Users size={22} />
        </div>
        <h3 className="text-[17px] font-semibold text-[#1C1C1E]">Build this session’s fee grid</h3>
        <p className="text-[14px] text-[rgba(60,60,67,0.6)] mt-1 max-w-[46ch] mx-auto">
          Add your terms and the fee heads you charge above. Each grade then gets a row, and every term-wise and monthly head a column to price.
        </p>
      </div>
    )
  }

  const bandTint = (band: number) => (band === terms.length ? 'bg-[#30B0C7]/[0.035]' : band % 2 ? 'bg-[#007AFF]/[0.025]' : '')
  const headCellW = (h: HeadRow) => (h.gender_split ? 'w-[168px] min-w-[168px]' : 'w-[112px] min-w-[112px]')
  const STICKY_HEAD = 'sticky z-20 bg-white/75 backdrop-blur-xl backdrop-saturate-150'

  return (
    <div className="w-fit max-w-full rounded-[20px] bg-white ring-1 ring-black/[0.05] shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)] overflow-hidden">
      <div className="overflow-auto max-h-[calc(100dvh-220px)] min-h-[320px] overscroll-contain">
        <table ref={tableRef} className="border-separate border-spacing-0 text-[13px] text-[#1C1C1E] w-max">
          <thead>
            <tr>
              <th rowSpan={2}
                  className={`${STICKY_HEAD} top-0 left-0 z-30 w-[136px] min-w-[136px] sm:w-[196px] sm:min-w-[196px] text-left px-3 sm:px-4 border-b border-r border-[rgba(60,60,67,0.12)] align-bottom pb-2.5`}>
                <span className="text-[12px] font-semibold text-[rgba(60,60,67,0.6)]">Grade</span>
              </th>
              {terms.map((t, i) => (
                <th key={t.id} colSpan={Math.max(termHeads.length, 1)}
                    className={`${STICKY_HEAD} top-0 h-[44px] px-3 text-left border-b border-r border-[rgba(60,60,67,0.12)] ${bandTint(i)}`}>
                  <button onClick={() => onEditTerm(t)} className="text-left group" disabled={!canEdit}>
                    <span className="block text-[13.5px] font-semibold text-[#1C1C1E] group-hover:text-[#007AFF] group-disabled:group-hover:text-[#1C1C1E]">{t.name}</span>
                    <span className="block text-[11.5px] font-normal text-[rgba(60,60,67,0.6)]">Due {shortDate(t.due_date)}</span>
                  </button>
                </th>
              ))}
              {monthHeads.length > 0 && (
                <th colSpan={monthHeads.length}
                    className={`${STICKY_HEAD} top-0 h-[44px] px-3 text-left border-b border-r border-[rgba(60,60,67,0.12)] ${bandTint(terms.length)}`}>
                  <span className="block text-[13.5px] font-semibold">Monthly</span>
                  <span className="block text-[11.5px] font-normal text-[rgba(60,60,67,0.6)]">Charged every month issued</span>
                </th>
              )}
              <th rowSpan={2}
                  className={`${STICKY_HEAD} top-0 w-[240px] min-w-[240px] px-3 text-left border-b border-[rgba(60,60,67,0.12)] align-bottom pb-2.5`}>
                <span className="block text-[13.5px] font-semibold">Other</span>
                <span className="block text-[11.5px] font-normal text-[rgba(60,60,67,0.6)]">One-off fees and fines</span>
              </th>
            </tr>
            <tr>
              {termHeads.length === 0 && terms.map(t => (
                <th key={t.id} className={`${STICKY_HEAD} top-[44px] px-3 h-[34px] min-w-[140px] border-b border-r border-[rgba(60,60,67,0.12)] text-[11.5px] font-normal text-[rgba(60,60,67,0.45)] text-left`}>
                  No term-wise heads yet
                </th>
              ))}
              {columns.map(col => (
                <th key={col.key}
                    className={`${STICKY_HEAD} top-[44px] h-[34px] px-3 border-b border-r border-[rgba(60,60,67,0.12)] text-left ${headCellW(col.head)} ${bandTint(col.band)}`}>
                  <button onClick={() => onEditHead(col.head)} disabled={!canEdit}
                          className="text-[12px] font-semibold text-[rgba(60,60,67,0.8)] hover:text-[#007AFF] disabled:hover:text-[rgba(60,60,67,0.8)] inline-flex items-center gap-1.5">
                    {col.head.name}
                    {col.head.gender_split && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold">
                        <span style={{ color: BOY }}>B</span><span className="text-[rgba(60,60,67,0.3)]">/</span><span style={{ color: GIRL }}>G</span>
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const id = rowId(row)
              const group = row.group_id ? groups.find(g => g.id === row.group_id) : null
              const n = counts.get(id) ?? 0
              const isBase = !row.group_id
              const rowCharges = isBase ? chargesByRow.get(id) ?? [] : []
              const zebra = row.grade === null ? 'bg-[#F2F2F7]/60' : ''
              return (
                <tr key={id} className={`group/row ${zebra}`}>
                  <th scope="row"
                      className={`sticky left-0 z-10 text-left font-normal px-3 sm:px-4 py-1.5 border-b border-r border-[rgba(60,60,67,0.12)] ${row.grade === null ? 'bg-[#F7F7FA]' : 'bg-white'}`}>
                    {group ? (
                      <button onClick={() => canEdit && onEditGroup(group)} className="flex items-start gap-2 text-left pl-3 w-full">
                        <span className="mt-[3px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: SYS.indigo }} />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-medium text-[#1C1C1E] truncate">{group.name}</span>
                          <span className="block text-[11.5px] text-[rgba(60,60,67,0.6)]">
                            Sections {group.sections.join(', ') || '—'} · {n}
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="block text-[14px] font-semibold text-[#1C1C1E] truncate">
                            {row.grade === null ? NO_GRADE_LABEL : gradeLabel(row.grade)}
                          </span>
                          <span className="block text-[11.5px] text-[rgba(60,60,67,0.6)]">
                            {row.grade === null ? `Not in a class · ${n}` : `${n} student${n === 1 ? '' : 's'}`}
                          </span>
                        </div>
                        {row.grade !== null && canEdit && (
                          <button
                            onClick={() => onAddGroup(row.grade as number)}
                            title={`Add a group to ${gradeLabel(row.grade)}`}
                            aria-label={`Add a group to ${gradeLabel(row.grade)}`}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[#007AFF] bg-[#007AFF]/[0.08]
                                       opacity-60 group-hover/row:opacity-100 hover:bg-[#007AFF]/15 transition-opacity flex-shrink-0"
                          >
                            <Plus size={14} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    )}
                  </th>

                  {termHeads.length === 0 && terms.map(t => (
                    <td key={t.id} className="border-b border-r border-[rgba(60,60,67,0.12)]" />
                  ))}

                  {columns.map((col, c) => {
                    const locked = lockIx.has(lockKey(row, col.head.id, col.termId))
                    const scoped = inScope(row, col)
                    const valueOf = (g: Gender) => rateIx.get(rateKey(row, col.head.id, col.termId, g)) ?? null
                    const tint = locked ? 'bg-[#34C759]/[0.07]' : scoped ? 'bg-[#007AFF]/[0.07]' : bandTint(col.band)
                    return (
                      <td key={col.key}
                          className={`p-0 border-b border-r border-[rgba(60,60,67,0.12)] ${tint} ${scoped ? 'shadow-[inset_0_0_0_1px_rgba(0,122,255,0.25)]' : ''}`}>
                        {col.head.gender_split ? (
                          <div className="flex h-full divide-x divide-[rgba(60,60,67,0.1)]">
                            {(['male', 'female'] as const).map((g, gi) => (
                              <AmountCell key={g} value={valueOf(g)} locked={locked} disabled={!canEdit}
                                r={r} c={c * 2 + gi} mark={g === 'male' ? 'B' : 'G'} markColor={g === 'male' ? BOY : GIRL}
                                onNav={(dr) => focusCell(r + dr, c * 2 + gi)}
                                onCommit={amount => onCommit({ ...row, head_id: col.head.id, term_id: col.termId, gender: g, amount })} />
                            ))}
                          </div>
                        ) : (
                          <AmountCell value={valueOf('any')} locked={locked} disabled={!canEdit}
                            r={r} c={c * 2}
                            onNav={(dr) => focusCell(r + dr, c * 2)}
                            onCommit={amount => onCommit({ ...row, head_id: col.head.id, term_id: col.termId, gender: 'any', amount })} />
                        )}
                      </td>
                    )
                  })}

                  <td className="px-2.5 py-1.5 border-b border-[rgba(60,60,67,0.12)] align-middle">
                    <div className="flex flex-wrap gap-1 max-w-[320px]">
                      {rowCharges.map(ch => {
                        const tone = ch.kind === 'fine' ? SYS.red : SYS.indigo
                        const issued = issuedCharge.has(ch.id)
                        return (
                          <button
                            key={ch.id}
                            onClick={() => onOpenCharge(ch)}
                            title={`${ch.title} · ₹${ch.amount.toLocaleString('en-IN')} · ${issued ? 'issued' : 'draft'}`}
                            className="inline-flex items-center gap-1 max-w-[200px] rounded-full h-6 px-2.5 text-[12px] font-medium transition-transform active:scale-[0.97]"
                            style={issued
                              ? { background: `${tone}17`, color: tone }
                              : { background: 'transparent', color: tone, boxShadow: `inset 0 0 0 1px ${tone}66` }}
                          >
                            {issued && <CheckCircle2 size={11} className="flex-shrink-0" />}
                            <span className="truncate">{ch.title}</span>
                          </button>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 border-t border-[rgba(60,60,67,0.12)] text-[11.5px] text-[rgba(60,60,67,0.6)] bg-[#FBFBFD]">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[4px] bg-[#34C759]/20 inline-flex items-center justify-center"><Lock size={8} color={SYS.green} /></span> Issued — locked</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[4px] bg-[#007AFF]/15 ring-1 ring-[#007AFF]/30" /> In the issue selection</span>
        <span className="inline-flex items-center gap-1.5"><span className="font-semibold" style={{ color: BOY }}>B</span>/<span className="font-semibold" style={{ color: GIRL }}>G</span> Boys / girls</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${SYS.indigo}` }} /> Draft other fee</span>
        <span className="ml-auto">Enter moves down · Esc cancels</span>
      </div>
    </div>
  )
}

function fmt(v: number | null): string {
  if (v === null) return ''
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function AmountCell({
  value, locked, disabled, onCommit, r, c, mark, markColor, onNav,
}: {
  value: number | null
  locked: boolean
  disabled: boolean
  onCommit: (amount: number | null) => Promise<void>
  r: number
  c: number
  mark?: string
  markColor?: string
  onNav: (dr: number) => void
}) {
  const [text, setText] = useState(fmt(value))
  const [focused, setFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bad, setBad] = useState(false)

  useEffect(() => { if (!focused) setText(value === null ? '' : String(value)) }, [value, focused])

  const commit = async () => {
    const raw = text.replace(/[₹,\s]/g, '')
    const next = raw === '' ? null : Number(raw)
    if (next !== null && (!Number.isFinite(next) || next < 0)) { setBad(true); return }
    setBad(false)
    if (next === value) return
    setSaving(true)
    try { await onCommit(next) } catch { setBad(true); setText(value === null ? '' : String(value)) }
    finally { setSaving(false) }
  }

  if (locked) {
    return (
      <div className="relative flex items-center justify-end gap-1 h-[46px] px-2.5 min-w-0 flex-1 text-[13.5px] tabular-nums text-[#1C1C1E]/80"
           title="Issued — undo the issue to change this">
        {mark && <span className="absolute left-2 top-1 text-[9.5px] font-bold" style={{ color: markColor }}>{mark}</span>}
        <Lock size={10} className="text-[#34C759] flex-shrink-0" />
        {value === null ? <span className="text-[rgba(60,60,67,0.3)]">—</span> : fmt(value)}
      </div>
    )
  }

  return (
    <label className="relative flex-1 block min-w-0">
      {mark && (
        <span className="pointer-events-none absolute left-2 top-1 text-[9.5px] font-bold" style={{ color: markColor }}>{mark}</span>
      )}
      <input
        data-r={r} data-c={c}
        inputMode="decimal"
        disabled={disabled}
        value={focused ? text : fmt(value)}
        placeholder="—"
        onFocus={e => { setFocused(true); setText(value === null ? '' : String(value)); requestAnimationFrame(() => e.target.select()) }}
        onChange={e => { setText(e.target.value); setBad(false) }}
        onBlur={() => { setFocused(false); void commit() }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); onNav(e.shiftKey ? -1 : 1) }
          if (e.key === 'Escape') { setText(value === null ? '' : String(value)); setFocused(false); (e.target as HTMLInputElement).blur() }
          if (e.key === 'ArrowDown') { e.preventDefault(); onNav(1) }
          if (e.key === 'ArrowUp') { e.preventDefault(); onNav(-1) }
        }}
        className={`w-full h-[46px] bg-transparent text-right pr-2.5 ${mark ? 'pl-5' : 'pl-2'} text-[13.5px] tabular-nums
                    placeholder:text-[rgba(60,60,67,0.22)] focus:outline-none focus:bg-white focus:shadow-[inset_0_0_0_2px_#007AFF]
                    hover:bg-black/[0.02] disabled:cursor-default transition-shadow
                    ${bad ? 'shadow-[inset_0_0_0_2px_#FF3B30] text-[#FF3B30]' : ''} ${saving ? 'opacity-60' : ''}`}
      />
    </label>
  )
}
