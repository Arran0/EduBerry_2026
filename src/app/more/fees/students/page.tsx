'use client'

// The student list, and where fee profiles get created in bulk.
//
// The preview before committing is the point: "will create 412 · skip 38
// (already have one) · skip 6 (RTE)" runs exactly the same query the commit
// does, so the number a clerk approves is the number that happens.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, Check, GraduationCap, Loader2, Search, UserPlus,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import ModalShell from '@/components/ui/ModalShell'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
import { FeeScreen, StatStrip, TabBar, Btn, Empty, Loading } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import { gradeLabel } from '@/lib/grades'
import { supabase } from '@/lib/supabase'
import { fetchFeeConfig, type FeeGroupRow } from '@/lib/fees/config'
import {
  createProfiles, fetchProfileList, type CreateProfilesResult, type ProfileListRow,
} from '@/lib/fees/invoices'

function StudentsInner() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [rows, setRows] = useState<ProfileListRow[]>([])
  const [groups, setGroups] = useState<FeeGroupRow[]>([])
  const [query, setQuery] = useState('')
  const [gradeFilter, setGradeFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

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
    <FeeScreen
      title="Student Fees"
      subtitle={<>{rows.length} fee {rows.length === 1 ? 'profile' : 'profiles'} for {year?.code}</>}
      icon={<GraduationCap size={17} style={{ color: '#B8983C' }} />}
      back={{ href: '/more/fees', label: 'Fees' }}
      actions={<YearScope />}
    >
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
        {perms.can('fees.profile.create') && (
          <button onClick={() => setCreating(true)} className={ADMIN.darkBtn}>
            <UserPlus size={13} /> Create profiles
          </button>
        )}
      </div>

      {loading ? (
        <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : rows.length === 0 ? (
        <div className={`${ADMIN.card} py-16 text-center px-6`}>
          <p className="text-sm text-[#6B675A] max-w-md mx-auto">
            No fee profiles exist for {year?.code} yet. A profile is a student&rsquo;s account for
            the session — nothing can be billed or collected until they have one.
          </p>
          {perms.can('fees.profile.create') && (
            <button onClick={() => setCreating(true)} className={`${ADMIN.darkBtn} mt-4 mx-auto`}>
              <UserPlus size={13} /> Create them now
            </button>
          )}
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


      {creating && year && (
        <CreateProfilesDialog
          academicYearId={year.id}
          yearCode={year.code}
          groups={groups}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); void load() }}
        />
      )}
    </FeeScreen>
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

function CreateProfilesDialog({
  academicYearId, yearCode, groups, onClose, onDone,
}: {
  academicYearId: string
  yearCode: string
  groups: FeeGroupRow[]
  onClose: () => void
  onDone: () => void
}) {
  const [scope, setScope] = useState<'all' | 'grade'>('all')
  const [grade, setGrade] = useState('')
  const [groupId, setGroupId] = useState('')
  const [preview, setPreview] = useState<CreateProfilesResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const studentIds = useCallback(async (): Promise<string[] | undefined> => {
    if (scope === 'all') return undefined
    const { data } = await supabase.from('profiles')
      .select('id').eq('role', 'student').eq('grade', Number(grade))
    return (data ?? []).map(r => r.id as string)
  }, [scope, grade])

  const run = async (commit: boolean) => {
    setBusy(true); setError(null)
    try {
      const result = await createProfiles({
        academic_year_id: academicYearId,
        student_ids: await studentIds(),
        fee_group_id: groupId || undefined,
        commit,
      })
      if (commit) onDone()
      else setPreview(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} sharp size="md" title={`Create fee profiles for ${yearCode}`}>
      <div className="space-y-4">
        <p className="text-sm text-[#52525B]">
          A profile is a student&rsquo;s fee account for the session. It pins the structure that
          prices them, so publishing a revised structure later cannot re-price bills already sent.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>Who</label>
            <select value={scope} onChange={e => { setScope(e.target.value as 'all' | 'grade'); setPreview(null) }}
                    className={ADMIN.inputPlain}>
              <option value="all">Every student in the school</option>
              <option value="grade">One class</option>
            </select>
          </div>
          {scope === 'grade' && (
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Class</label>
              <select value={grade} onChange={e => { setGrade(e.target.value); setPreview(null) }}
                      className={ADMIN.inputPlain}>
                <option value="">Choose…</option>
                {[-3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(g => (
                  <option key={g} value={String(g)}>{gradeLabel(g)}</option>
                ))}
              </select>
            </div>
          )}
          <div className={scope === 'grade' ? 'sm:col-span-2' : ''}>
            <label className={`${ADMIN.label} block mb-1.5`}>Fee group</label>
            <select value={groupId} onChange={e => { setGroupId(e.target.value); setPreview(null) }}
                    className={ADMIN.inputPlain}>
              <option value="">The default group</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}{g.is_default ? ' (default)' : ''}</option>
              ))}
            </select>
            <p className="text-xs text-[#8C8878] mt-1.5">
              A student already assigned to a group keeps it — a bulk run never sweeps someone out
              of RTE or Staff Ward.
            </p>
          </div>
        </div>

        {preview && (
          <div className="bg-[#FAF8F2] border border-[#E3DFD3] p-4 space-y-1.5">
            <p className="text-sm font-semibold text-[#18181B]">
              Will create {preview.created} profile{preview.created === 1 ? '' : 's'}
            </p>
            {preview.skipped_existing > 0 && (
              <p className="text-xs text-[#6B675A]">
                Skipping {preview.skipped_existing} who already have one for this session.
              </p>
            )}
            {preview.rte > 0 && (
              <p className="text-xs text-[#6B675A]">
                {preview.rte} are RTE — they get a profile but will not be billed.
              </p>
            )}
            {preview.without_structure > 0 && (
              <p className="text-xs text-[#7A6220] flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                {preview.without_structure} have no published structure covering their class.
                They can be created now, but nothing can be billed to them until one exists.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3 ">{error}</div>
        )}

        <div className="flex gap-2">
          {!preview ? (
            <button onClick={() => void run(false)}
                    disabled={busy || (scope === 'grade' && !grade)}
                    className={`${ADMIN.darkBtn} flex-1 py-2.5`}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : null} Preview
            </button>
          ) : (
            <button onClick={() => void run(true)} disabled={busy || preview.created === 0}
                    className={`${ADMIN.darkBtn} flex-1 py-2.5`}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Create {preview.created}
            </button>
          )}
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        </div>
      </div>
    </ModalShell>
  )
}

export default function FeeStudentsPage() {
  return (
    <ProtectedLayout staffOnly>
      <AcademicYearProvider>
        <StudentsInner />
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
