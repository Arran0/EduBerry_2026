'use client'

// The student list: every student with a fee account this session, what they
// were billed, what they paid and what they still owe.
//
// Accounts are made the first time a fee is issued to a student from Fee
// Configuration, so there is no separate "create profiles" step any more. The
// group column is the fee grid's own — the group in a grade that owns the
// student's section, if one does.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Search } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, inr } from '@/components/fees/ui'
import { CELL, Col, List, ListHead, Row, StatStrip } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import { gradeLabel } from '@/lib/grades'
import { supabase } from '@/lib/supabase'
import { fetchProfileList, type ProfileListRow } from '@/lib/fees/invoices'

interface GridGroup { id: string; grade: number; name: string; sections: string[] }

/**
 * The roster's columns on a laptop. On a phone the billed figure and the fee
 * group step aside — a name, a class and what is still owed is what the list is
 * for, and the rest is one tap away on the student's own page.
 */
const ROSTER_COLS = 'sm:grid-cols-[minmax(0,1fr)_96px_minmax(0,148px)_104px_104px_104px]'

export default function StudentsSection() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [rows, setRows] = useState<ProfileListRow[]>([])
  const [groups, setGroups] = useState<GridGroup[]>([])
  const [query, setQuery] = useState('')
  const [gradeFilter, setGradeFilter] = useState<string>('')
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

  const grades = useMemo(
    () => [...new Set(rows.map(r => r.grade).filter(g => g !== null))].sort((a, b) => (a as number) - (b as number)),
    [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r =>
      (!q || r.full_name.toLowerCase().includes(q) || (r.admission_no ?? '').toLowerCase().includes(q)) &&
      (gradeFilter === '' || String(r.grade) === gradeFilter))
  }, [rows, query, gradeFilter])

  const totals = useMemo(() => ({
    billed: filtered.reduce((a, r) => a + (r.billed ?? 0), 0),
    paid: filtered.reduce((a, r) => a + (r.paid ?? 0), 0),
    due: filtered.reduce((a, r) => a + (r.outstanding ?? 0), 0),
    withDues: filtered.filter(r => (r.outstanding ?? 0) > 0).length,
  }), [filtered])

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!perms.can('fees.profile.view')) return <NoAccess what="see student fee profiles" />

  return (
    <>
      <StatStrip
        loading={loading}
        stats={[
          { label: 'Billed', value: inr(totals.billed, showAmounts) },
          { label: 'Collected', value: inr(totals.paid, showAmounts) },
          { label: 'Outstanding', value: inr(totals.due, showAmounts),
            tone: totals.due > 0 ? '#7A6220' : undefined, strong: true },
          { label: 'Families with dues', value: String(totals.withDues) },
        ]}
      />

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <div className="relative flex-1 min-w-[150px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C8878]" />
          <input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Name or admission number" className={ADMIN.input} />
        </div>
        <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}
                aria-label="Class" className={`${ADMIN.select} ${gradeFilter ? '!border-[#27272A]' : ''}`}>
          <option value="">Every class</option>
          {grades.map(g => <option key={g} value={String(g)}>{gradeLabel(g as number)}</option>)}
        </select>
        <span className="text-[11px] text-[#8C8878] tabular-nums ml-auto max-sm:hidden">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {loading ? (
        <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : rows.length === 0 ? (
        <div className={`${ADMIN.card} py-16 text-center px-6`}>
          <p className="text-[12.5px] text-[#6B675A] max-w-md mx-auto">
            Nobody has been billed in {year?.code} yet. A student appears here the first time a
            fee is issued to them from Fee Configuration.
          </p>
          {perms.can('fees.invoice.generate') && (
            <Link href="/more/fees?tab=config" className={`${ADMIN.darkBtn} mt-4`}>
              Go to Fee Configuration
            </Link>
          )}
        </div>
      ) : (
        <List>
          <ListHead cols={ROSTER_COLS}>
            <Col>Student</Col>
            <Col>Class</Col>
            <Col>Group</Col>
            <Col right>Billed</Col>
            <Col right>Paid</Col>
            <Col right>Due</Col>
          </ListHead>

          {filtered.map(r => {
            const sec = (r.section ?? '').trim().toUpperCase()
            const group = groups.find(g => g.grade === r.grade && g.sections.includes(sec))?.name
            return (
              <Row key={r.id} cols={ROSTER_COLS}>
                <span className={`${CELL.A1} flex flex-wrap items-baseline gap-x-1.5 gap-y-1`}>
                  <Link href={`/more/fees/students/${r.student_id}`}
                        className="font-medium text-[12.5px] text-[#18181B] hover:underline">
                    {r.full_name}
                  </Link>
                  {r.admission_no && (
                    <span className="text-[11px] text-[#8C8878]">{r.admission_no}</span>
                  )}
                  {r.is_rte && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]">
                      RTE
                    </span>
                  )}
                </span>
                <span className={`${CELL.A2} text-[11px] text-[#8C8878] truncate`}>
                  {r.grade === null ? '—' : gradeLabel(r.grade)}{r.section ? ` ${r.section}` : ''}
                  {/* The group rides along with the class on a phone rather than
                      costing a line of its own. */}
                  <span className="sm:hidden">{group ? ` · ${group}` : ''}</span>
                </span>
                <span className={`${CELL.DESKTOP} text-[12.5px] text-[#6B675A] truncate`}>
                  {group ?? '—'}
                </span>
                <span className={`${CELL.DESKTOP} text-right text-[11.5px] text-[#6B675A] tabular-nums`}>
                  {inr(r.billed, showAmounts)}
                </span>
                <span className={`${CELL.B2} text-[11px] text-right text-[#8C8878] tabular-nums`}>
                  {inr(r.paid, showAmounts)}<span className="sm:hidden"> paid</span>
                </span>
                <span className={`${CELL.B1} text-[11.5px] text-right font-semibold tabular-nums ${
                  (r.outstanding ?? 0) > 0 ? 'text-[#7A6220]' : 'text-[#8C8878]'}`}>
                  {inr(r.outstanding, showAmounts)}
                </span>
              </Row>
            )
          })}
        </List>
      )}


    </>
  )
}
