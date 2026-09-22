'use client'

// The student list: who has a fee account this session, and what they owe.
//
// There used to be a "Create profiles" button here, with a scope picker, a
// group picker and a preview. It is gone. A fee account is not a decision
// anybody takes — it is bookkeeping implied by the price list, and asking a
// clerk to run it as a separate errand only ever produced one failure: a class
// admitted after the last run silently got no bills. Generating bills now
// opens the accounts that run needs, so this screen reports rather than acts.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Search } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, inr } from '@/components/fees/ui'
import { StatStrip } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import { gradeLabel } from '@/lib/grades'
import { fetchFeeConfig, type FeeGroupRow } from '@/lib/fees/config'
import { fetchProfileList, type ProfileListRow } from '@/lib/fees/invoices'

export default function StudentsSection() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [rows, setRows] = useState<ProfileListRow[]>([])
  const [groups, setGroups] = useState<FeeGroupRow[]>([])
  const [query, setQuery] = useState('')
  const [gradeFilter, setGradeFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const showAmounts = !perms.amountsHidden

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [list, config] = await Promise.all([
        fetchProfileList(year.id),
        fetchFeeConfig(year.id),
      ])
      setRows(list)
      setGroups(config.groups)
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

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C8878]" />
          <input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Name or admission number" className={ADMIN.input} />
        </div>
        <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}
                className={`${ADMIN.inputPlain} w-40`}>
          <option value="">Every class</option>
          {grades.map(g => <option key={g} value={String(g)}>{gradeLabel(g as number)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : rows.length === 0 ? (
        <div className={`${ADMIN.card} py-16 text-center px-6`}>
          <p className="text-sm text-[#6B675A] max-w-md mx-auto">
            Nobody has a fee account for {year?.code} yet. They are opened by the first bill run:
            publish a structure in Fee Configuration, then press{' '}
            <strong className="text-[#18181B]">Generate bills</strong> on the Collection screen and
            every student the price list covers gets an account and their first bill together.
          </p>
        </div>
      ) : (
        <div className={`${ADMIN.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#FAF8F2] border-b border-[#E3DFD3]">
                  <Th>Student</Th><Th>Class</Th><Th>Group</Th>
                  <Th right>Billed</Th><Th right>Paid</Th><Th right>Due</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-[#F0ECE2] last:border-0 hover:bg-[#FAF8F2]">
                    <td className="px-4 py-2.5">
                      <Link href={`/more/fees/students/${r.student_id}`}
                            className="font-medium text-[#18181B] hover:underline">
                        {r.full_name}
                      </Link>
                      {r.admission_no && (
                        <span className="text-xs text-[#8C8878] ml-2">{r.admission_no}</span>
                      )}
                      {r.is_rte && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]">
                          RTE
                        </span>
                      )}
                      {!r.structure_id && !r.is_rte && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]">
                          No structure
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[#6B675A]">
                      {r.grade === null ? '—' : gradeLabel(r.grade)}{r.section ? ` ${r.section}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-[#6B675A]">
                      {groups.find(g => g.id === r.fee_group_id)?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#6B675A]">{inr(r.billed, showAmounts)}</td>
                    <td className="px-4 py-2.5 text-right text-[#6B675A]">{inr(r.paid, showAmounts)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${
                      (r.outstanding ?? 0) > 0 ? 'text-[#7A6220]' : 'text-[#8C8878]'}`}>
                      {inr(r.outstanding, showAmounts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A] ${
      right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}
