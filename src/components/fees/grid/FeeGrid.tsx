'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The grid: every grade down the side, every term (and its term-wise heads),
// then the monthly heads, then "Other" across the top. A cell is one price.
// A head that differs for boys and girls gets a double cell.
//
// Drawn as the payroll sheet is: a dark header the columns hang from, hairline
// rules, figures right-aligned in tabular numerals, and the paper ramp — not
// colour — to band one term from the next.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Lock, Plus } from 'lucide-react'
import { gradeLabel } from '@/lib/grades'
import {
  NO_GRADE_LABEL, gridRows, indexLocks, indexRates, lockKey, rateKey, rowId,
  type ChargeRow, type Gender, type GridRowKey, type GroupRow, type HeadRow,
  type IssueCellRow, type IssueRow, type RateEdit, type RateRow, type StudentLite, type TermRow,
} from '@/lib/fees/grid'
import { BOY, GIRL, shortDate } from './kit'
import type { IssueScope } from './IssuePanel'

interface Column {
  key: string
  head: HeadRow
  termId: string | null
  /** Which band (term, or monthly) the column sits in. */
  band: number
}

const RULE = 'border-[#E3DFD3]'
const HAIR = 'border-[#F0ECE2]'

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
      <div className="bg-white border border-[#E3DFD3] px-6 py-14 text-center">
        <p className="text-[12.5px] font-semibold text-[#18181B]">Build this session’s fee grid</p>
        <p className="text-[12px] text-[#8C8878] mt-1 max-w-[52ch] mx-auto leading-relaxed">
          Add the terms and the fee heads the school charges above. Each grade then gets a row, and every
          term-wise and monthly head a column to price.
        </p>
      </div>
    )
  }

  /** Alternate terms sit on paper, so a wide grid still reads as blocks of columns. */
  const band = (b: number) => (b === terms.length ? 'bg-[#FAF8F2]' : b % 2 ? 'bg-[#FDFCF9]' : '')
  const colW = (h: HeadRow) => (h.gender_split ? 'w-[156px] min-w-[156px]' : 'w-[104px] min-w-[104px]')
  const HEAD1 = 'sticky top-0 z-20 bg-[#27272A] h-[40px] px-2.5 text-left align-middle border-r border-[#3F3F46]'
  const HEAD2 = 'sticky top-[40px] z-20 bg-[#3F3F46] h-[28px] px-2.5 text-left align-middle border-r border-[#52525B]'

  return (
    <div className="bg-white border border-[#E3DFD3] -mx-3 sm:mx-0 max-sm:border-x-0">
      <div className="overflow-auto max-h-[calc(100dvh-180px)] min-h-[320px] overscroll-contain">
        <table ref={tableRef} className="border-separate border-spacing-0 text-[12px] text-[#18181B] w-max min-w-full">
          <thead>
            <tr>
              <th rowSpan={2}
                  className="sticky top-0 left-0 z-30 bg-[#27272A] w-[128px] min-w-[128px] sm:w-[184px] sm:min-w-[184px] px-3 text-left align-bottom pb-2 border-r border-[#3F3F46]">
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#A1A1AA]">Grade</span>
              </th>
              {terms.map(t => (
                <th key={t.id} colSpan={Math.max(termHeads.length, 1)} className={HEAD1}>
                  <button onClick={() => onEditTerm(t)} disabled={!canEdit} className="text-left group">
                    <span className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-white group-hover:text-[#B8983C] group-disabled:group-hover:text-white">
                      {t.name}
                    </span>
                    <span className="block text-[10px] font-normal text-[#A1A1AA] tabular-nums">Due {shortDate(t.due_date)}</span>
                  </button>
                </th>
              ))}
              {monthHeads.length > 0 && (
                <th colSpan={monthHeads.length} className={HEAD1}>
                  <span className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-white">Monthly</span>
                  <span className="block text-[10px] font-normal text-[#A1A1AA]">Each month issued</span>
                </th>
              )}
              <th rowSpan={2}
                  className="sticky top-0 z-20 bg-[#27272A] min-w-[220px] px-2.5 text-left align-bottom pb-2">
                <span className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-white">Other</span>
                <span className="block text-[10px] font-normal text-[#A1A1AA]">One-off fees and fines</span>
              </th>
            </tr>
            <tr>
              {termHeads.length === 0 && terms.map(t => (
                <th key={t.id} className={`${HEAD2} min-w-[140px]`}>
                  <span className="text-[9.5px] font-semibold text-[#A1A1AA] normal-case">No term-wise heads yet</span>
                </th>
              ))}
              {columns.map(col => (
                <th key={col.key} className={`${HEAD2} ${colW(col.head)}`}>
                  <button onClick={() => onEditHead(col.head)} disabled={!canEdit}
                          className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#E4E4E7] hover:text-[#B8983C] disabled:hover:text-[#E4E4E7] max-w-full">
                    <span className="truncate">{col.head.name}</span>
                    {col.head.gender_split && (
                      <span className="text-[9px] tracking-normal flex-shrink-0">
                        <span style={{ color: '#9DB0DD' }}>B</span><span className="text-[#71717A]">/</span><span style={{ color: '#E39BB3' }}>G</span>
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
              const rowCharges = row.group_id ? [] : chargesByRow.get(id) ?? []
              const head = row.grade === null ? 'bg-[#FAF8F2]' : group ? 'bg-[#FDFCF9]' : 'bg-white'
              // A heavier rule above each grade, so a grade and its groups read as one block.
              const top = !group && r > 0 ? 'border-t border-t-[#D6D2C4]' : ''
              return (
                <tr key={id} className="group/row">
                  <th scope="row"
                      className={`sticky left-0 z-10 text-left font-normal px-3 py-1 border-r border-b border-r-[#E3DFD3] border-b-[#F0ECE2] ${head} ${top}`}>
                    {group ? (
                      <button onClick={() => canEdit && onEditGroup(group)} className="flex items-start gap-1.5 text-left w-full pl-2.5 border-l-2 border-[#B8983C]">
                        <span className="min-w-0">
                          <span className="block text-[12px] font-semibold text-[#3F3F46] truncate">{group.name}</span>
                          <span className="block text-[10.5px] text-[#8C8878] truncate">
                            {group.sections.join(', ') || '—'} · {n}
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-bold text-[#18181B] truncate">
                            {row.grade === null ? NO_GRADE_LABEL : gradeLabel(row.grade)}
                          </span>
                          <span className="block text-[10.5px] text-[#8C8878] tabular-nums">
                            {row.grade === null ? `Not in a class · ${n}` : `${n} student${n === 1 ? '' : 's'}`}
                          </span>
                        </div>
                        {row.grade !== null && canEdit && (
                          <button
                            onClick={() => onAddGroup(row.grade as number)}
                            title={`Split ${gradeLabel(row.grade)} into a group by section`}
                            aria-label={`Add a group to ${gradeLabel(row.grade)}`}
                            className="w-6 h-6 flex items-center justify-center border border-[#E3DFD3] text-[#8C8878]
                                       hover:border-[#27272A] hover:bg-[#27272A] hover:text-[#B8983C] transition-colors flex-shrink-0
                                       sm:opacity-0 sm:group-hover/row:opacity-100 focus:opacity-100"
                          >
                            <Plus size={13} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    )}
                  </th>

                  {termHeads.length === 0 && terms.map(t => (
                    <td key={t.id} className={`border-r border-b ${HAIR} ${top}`} />
                  ))}

                  {columns.map((col, c) => {
                    const locked = lockIx.has(lockKey(row, col.head.id, col.termId))
                    const scoped = inScope(row, col)
                    const valueOf = (g: Gender) => rateIx.get(rateKey(row, col.head.id, col.termId, g)) ?? null
                    const tint = locked ? 'bg-[#EAF5EE]' : scoped ? 'bg-[#FAF3DF]' : band(col.band)
                    return (
                      <td key={col.key}
                          className={`p-0 border-r border-b ${HAIR} ${top} ${tint} ${scoped && !locked ? 'shadow-[inset_0_0_0_1px_#E7D9AE]' : ''}`}>
                        {col.head.gender_split ? (
                          <div className="flex divide-x divide-[#F0ECE2]">
                            {(['male', 'female'] as const).map((g, gi) => (
                              <AmountCell key={g} value={valueOf(g)} locked={locked} disabled={!canEdit}
                                r={r} c={c * 2 + gi} mark={g === 'male' ? 'B' : 'G'} markColor={g === 'male' ? BOY : GIRL}
                                onNav={dr => focusCell(r + dr, c * 2 + gi)}
                                onCommit={amount => onCommit({ ...row, head_id: col.head.id, term_id: col.termId, gender: g, amount })} />
                            ))}
                          </div>
                        ) : (
                          <AmountCell value={valueOf('any')} locked={locked} disabled={!canEdit}
                            r={r} c={c * 2}
                            onNav={dr => focusCell(r + dr, c * 2)}
                            onCommit={amount => onCommit({ ...row, head_id: col.head.id, term_id: col.termId, gender: 'any', amount })} />
                        )}
                      </td>
                    )
                  })}

                  <td className={`px-2 py-1 border-b ${HAIR} ${top} align-middle`}>
                    <div className="flex flex-wrap gap-1 max-w-[300px]">
                      {rowCharges.map(ch => {
                        const issued = issuedCharge.has(ch.id)
                        const fine = ch.kind === 'fine'
                        const tone = fine ? 'text-[#A93232] border-[#EFCCCC]' : 'text-[#7A6220] border-[#E7D9AE]'
                        const fill = issued ? (fine ? 'bg-[#FCECEC]' : 'bg-[#FAF3DF]') : 'bg-white border-dashed'
                        return (
                          <button
                            key={ch.id}
                            onClick={() => onOpenCharge(ch)}
                            title={`${fine ? 'Fine' : 'Other fee'} · ${ch.title} · ₹${ch.amount.toLocaleString('en-IN')} · ${issued ? 'issued' : 'draft'}`}
                            className={`inline-flex items-center gap-1 max-w-[200px] border px-1.5 py-[3px] text-[10.5px] font-semibold
                                        leading-none hover:border-current transition-colors ${tone} ${fill}`}
                          >
                            {issued && <Check size={10} className="flex-shrink-0" strokeWidth={3} />}
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

      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t ${RULE} bg-[#FAF8F2] text-[10.5px] text-[#8C8878]`}>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 bg-[#EAF5EE] border border-[#C6E3D2] inline-flex items-center justify-center"><Lock size={7} className="text-[#1F6B42]" /></span>
          Issued — locked
        </span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 bg-[#FAF3DF] border border-[#E7D9AE]" /> In the issue selection</span>
        <span className="inline-flex items-center gap-1">
          <span className="font-bold" style={{ color: BOY }}>B</span>/<span className="font-bold" style={{ color: GIRL }}>G</span> Boys / girls
        </span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 border border-dashed border-[#B8983C]" /> Draft other fee</span>
        <span className="ml-auto max-sm:hidden">Enter moves down · Esc cancels</span>
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

  const markEl = mark && (
    <span className="pointer-events-none absolute left-1.5 top-1 text-[8.5px] font-bold" style={{ color: markColor }}>{mark}</span>
  )

  if (locked) {
    return (
      <div className="relative flex-1 min-w-0 flex items-center justify-end gap-1 h-[38px] px-2 text-[12px] tabular-nums text-[#1F6B42]"
           title="Issued — undo the issue to change this">
        {markEl}
        <Lock size={9} className="flex-shrink-0 opacity-70" />
        {value === null ? <span className="text-[#A8A395]">—</span> : fmt(value)}
      </div>
    )
  }

  return (
    <label className="relative flex-1 block min-w-0">
      {markEl}
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
        className={`w-full h-[38px] bg-transparent text-right pr-2 ${mark ? 'pl-4' : 'pl-1.5'} text-[12px] tabular-nums
                    placeholder:text-[#D6D2C4] focus:outline-none focus:bg-white focus:shadow-[inset_0_0_0_2px_#27272A]
                    hover:bg-[#FAF8F2] disabled:cursor-default
                    ${bad ? 'shadow-[inset_0_0_0_2px_#A93232] text-[#A93232]' : ''} ${saving ? 'opacity-50' : ''}`}
      />
    </label>
  )
}
