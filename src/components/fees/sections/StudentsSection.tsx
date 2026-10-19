'use client'

// The student list: every student with a fee account this session, what they
// were billed, what they paid and what they still owe — narrowed by class,
// section and whether anything is overdue.
//
// Accounts are made the first time a fee is issued to a student from Pricing,
// so there is no separate "create profiles" step. The group column is the fee
// grid's own: the group in a grade that owns the student's section, if one does.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlarmClock, GraduationCap, Loader2, Rows3, Search, X } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, CHIP, inr } from '@/components/fees/ui'
import { CELL, Col, Empty, List, ListHead, Row } from '@/components/fees/shell'
import { FeeDeck, FilterMenu, ResetChip } from '@/components/fees/glass'
import NoAccess from '@/components/fees/NoAccess'
import { gradeLabel } from '@/lib/grades'
import { supabase } from '@/lib/supabase'
import { fetchProfileList, type ProfileListRow } from '@/lib/fees/invoices'

interface GridGroup { id: string; grade: number; name: string; sections: string[] }

/** The roster's columns on a laptop. On a phone: a name, a class, what is owed. */
const ROSTER_COLS = 'sm:grid-cols-[minmax(0,1fr)_96px_minmax(0,140px)_104px_104px_112px]'

const OVERDUE_OPTIONS = [
  { key: 'yes', label: 'Has an overdue bill' },
  { key: 'no', label: 'Nothing overdue' },
]

export default function StudentsSection({
  overdueOnly, onOverdueOnlyChange,
}: {
  /** Driven by the Overdue students tile above. */
  overdueOnly: boolean
  onOverdueOnlyChange: (v: boolean) => void
}) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const router = useRouter()
  const [rows, setRows] = useState<ProfileListRow[]>([])
  const [groups, setGroups] = useState<GridGroup[]>([])
  const [query, setQuery] = useState('')
  const [grades, setGrades] = useState<string[]>([])
  const [sections, setSections] = useState<string[]>([])
  const [notOverdue, setNotOverdue] = useState(false)
  const [loading, setLoading] = useState(true)

  const showAmounts = !perms.amountsHidden

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [list, { data: grp }] = await Promise.all([
        fetchProfileList(year.id),
        supabase.from('fee_grade_groups').select('id, grade, name, sections').eq('academic_year_id', year.id),
      ])
      setRows(list)
      setGroups((grp ?? []) as GridGroup[])
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const gradeOptions = useMemo(
    () => [...new Set(rows.map(r => r.grade).filter((g): g is number => g !== null))].sort((a, b) => a - b),
    [rows])

  // Sections follow the classes picked: with Class 6 chosen, only Class 6's
  // sections are offered.
  const sectionOptions = useMemo(() => {
    const pool = grades.length ? rows.filter(r => r.grade !== null && grades.includes(String(r.grade))) : rows
    return [...new Set(pool.map(r => (r.section ?? '').trim().toUpperCase()).filter(Boolean))].sort()
  }, [rows, grades])

  useEffect(() => {
    setSections(s => s.filter(x => sectionOptions.includes(x)))
  }, [sectionOptions])

  const overdueValue = overdueOnly ? ['yes'] : notOverdue ? ['no'] : []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r =>
      (!q || r.full_name.toLowerCase().includes(q) || (r.admission_no ?? '').toLowerCase().includes(q)) &&
      (grades.length === 0 || (r.grade !== null && grades.includes(String(r.grade)))) &&
      (sections.length === 0 || sections.includes((r.section ?? '').trim().toUpperCase())) &&
      (!overdueOnly || r.overdue_bills > 0) &&
      (!notOverdue || r.overdue_bills === 0))
  }, [rows, query, grades, sections, overdueOnly, notOverdue])

  const narrowed = query.trim() !== '' || grades.length > 0 || sections.length > 0 || overdueOnly || notOverdue
  const reset = () => {
    setQuery(''); setGrades([]); setSections([]); setNotOverdue(false); onOverdueOnlyChange(false)
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
  }
  if (!perms.can('fees.profile.view')) return <NoAccess what="see student fee profiles" />

  return (
    <FeeDeck>
      <div className="px-1 pb-2.5 space-y-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Name or admission number"
                 className={`${ADMIN.input} !h-10 !rounded-full !pl-9`} />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear the search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterMenu
            label="Class"
            icon={GraduationCap}
            value={grades}
            onChange={setGrades}
            options={gradeOptions.map(g => ({ key: String(g), label: gradeLabel(g) }))}
            allLabel="All"
            width={240}
          />
          <FilterMenu
            label="Section"
            icon={Rows3}
            value={sections}
            onChange={setSections}
            options={sectionOptions.map(s => ({ key: s, label: `Section ${s}` }))}
            allLabel="All"
            width={220}
          />
          <FilterMenu
            label="Overdue"
            icon={AlarmClock}
            single
            value={overdueValue.length ? overdueValue : ['any']}
            onChange={v => {
              onOverdueOnlyChange(v[0] === 'yes')
              setNotOverdue(v[0] === 'no')
            }}
            options={[{ key: 'any', label: 'Everyone' }, ...OVERDUE_OPTIONS]}
            summary={overdueOnly ? 'Has overdue' : notOverdue ? 'None overdue' : 'Everyone'}
            active={overdueOnly || notOverdue}
          />
          {narrowed && <ResetChip onClick={reset} />}
          <span className="ml-auto pr-1 text-[12.5px] text-slate-500 tabular-nums">
            {filtered.length} of {rows.length}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="fx-card py-16 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="fx-card">
          <Empty>
            Nobody has been billed in {year?.code} yet. A student appears here the first time a
            fee is issued to them from Pricing.
          </Empty>
        </div>
      ) : filtered.length === 0 ? (
        <div className="fx-card"><Empty>No student matches these filters.</Empty></div>
      ) : (
        <List className="!mx-0 sm:!mx-0 max-sm:!border-x">
          <ListHead cols={ROSTER_COLS}>
            <Col>Student</Col>
            <Col>Class</Col>
            <Col>Fee group</Col>
            <Col right>Billed</Col>
            <Col right>Paid</Col>
            <Col right>Owing</Col>
          </ListHead>

          {filtered.map(r => {
            const sec = (r.section ?? '').trim().toUpperCase()
            const group = groups.find(g => g.grade === r.grade && g.sections.includes(sec))?.name
            const cls = r.grade === null ? '—' : `${gradeLabel(r.grade)}${r.section ? ` ${r.section}` : ''}`
            return (
              <Row key={r.id} cols={ROSTER_COLS} onClick={() => router.push(`/more/fees/students/${r.student_id}`)}>
                <span className={`${CELL.A1} min-w-0`}>
                  <span className="text-[13.5px] font-semibold text-slate-900 leading-snug break-words">{r.full_name}</span>
                  <span className="inline-flex flex-wrap gap-1 ml-1.5 align-middle">
                    {r.is_rte && <span className={`${CHIP} bg-[#E9EEFA] text-[#3A5490]`}>RTE</span>}
                    {r.overdue_bills > 0 && (
                      <span className={`${CHIP} bg-[#FBE7E7] text-[#A93232]`}>
                        {r.overdue_bills} overdue
                      </span>
                    )}
                  </span>
                  {r.admission_no && (
                    <span className="hidden sm:block text-[11.5px] text-slate-500">Adm. {r.admission_no}</span>
                  )}
                </span>
                <span className={`${CELL.A2} text-[12px] text-slate-500 break-words`}>
                  {cls}
                  <span className="sm:hidden">{group ? ` · ${group}` : ''}{r.admission_no ? ` · Adm. ${r.admission_no}` : ''}</span>
                </span>
                <span className={`${CELL.DESKTOP} text-[12.5px] text-slate-600 break-words`}>{group ?? '—'}</span>
                <span className={`${CELL.DESKTOP} text-right text-[12.5px] text-slate-600 tabular-nums`}>
                  {inr(r.billed, showAmounts)}
                </span>
                <span className={`${CELL.B2} text-[12px] text-right text-slate-500 tabular-nums`}>
                  {inr(r.paid, showAmounts)}<span className="sm:hidden"> paid</span>
                </span>
                <span className={`${CELL.B1} text-[13.5px] text-right font-bold tabular-nums ${
                  (r.outstanding ?? 0) > 0 ? (r.overdue_bills > 0 ? 'text-[#A93232]' : 'text-[#8A6A12]') : 'text-slate-400'}`}>
                  {inr(r.outstanding, showAmounts)}
                </span>
              </Row>
            )
          })}
        </List>
      )}
    </FeeDeck>
  )
}
