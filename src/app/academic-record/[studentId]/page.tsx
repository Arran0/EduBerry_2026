'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Award, Bookmark, FileText, GraduationCap,
  Loader2, MessageSquare, Printer, Save, Trash2,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, UserProfile, isStaffRole } from '@/lib/supabase'
import {
  StudentReportCardEntry,
  ReportCardRemark,
  fetchReportCardsForStudent,
  fetchAvailableAcademicYearsForStudent,
  fetchRemarksForStudent,
  upsertRemark,
  deleteRemark,
} from '@/lib/classrooms'
import { fetchBranding, SiteBranding, BRANDING_DEFAULTS } from '@/lib/pageConfig'
import { gradeLetter, formatShortDate, componentTotals } from '@/lib/reportCardGrading'
import { AssessmentBreakdown } from '@/components/academics/AssessmentBreakdown'
import { recordReportCardVisit } from '@/lib/reportCardVisits'

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AcademicRecordPage() {
  const params = useParams()
  const studentId = params.studentId as string
  const router = useRouter()
  const { profile: viewerProfile } = useAuth()

  const [student, setStudent] = useState<UserProfile | null>(null)
  const [loadingStudent, setLoadingStudent] = useState(true)
  const [branding, setBranding] = useState<SiteBranding>(BRANDING_DEFAULTS)

  const [years, setYears] = useState<string[]>([])
  const [selectedYear, setSelectedYear] = useState<string | null>(null)

  const [reportCards, setReportCards] = useState<Map<string, StudentReportCardEntry[]>>(new Map())
  const [remarks, setRemarks] = useState<ReportCardRemark[]>([])
  const [loadingCards, setLoadingCards] = useState(false)

  // Load student profile, branding, the academic-year list and the remarks.
  // None of these depend on each other — only the report cards themselves need
  // a year — so they all go out together instead of one waiting on the profile.
  // Only the header fields are selected: this page renders no other profile
  // column.
  useEffect(() => {
    fetchBranding().then(setBranding).catch(() => {})
    supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url, grade, section')
      .eq('id', studentId)
      .single()
      .then(({ data }) => {
        setStudent((data as UserProfile | null) ?? null)
        setLoadingStudent(false)
      })
    fetchAvailableAcademicYearsForStudent(studentId).then(ys => {
      setYears(ys)
      if (ys.length > 0) setSelectedYear(ys[0])
    })
  }, [studentId])

  // Remarks are per student, not per year, so a year switch leaves them alone.
  const loadRemarks = useCallback(
    () => fetchRemarksForStudent(studentId).then(setRemarks),
    [studentId],
  )
  useEffect(() => { loadRemarks() }, [loadRemarks])

  // Load report cards when the year changes
  const loadCards = useCallback(async (year: string | null) => {
    setLoadingCards(true)
    setReportCards(await fetchReportCardsForStudent(studentId, year))
    setLoadingCards(false)
  }, [studentId])

  useEffect(() => { loadCards(selectedYear) }, [selectedYear, loadCards])

  // Sort report card titles by most-recently-assessed date
  const sortedEntries = useMemo(() => {
    return Array.from(reportCards.entries()).sort(([, a], [, b]) => {
      const latest = (list: StudentReportCardEntry[]) =>
        Math.max(0, ...list.map(e => e.assessment.date ? new Date(e.assessment.date).getTime() : 0))
      return latest(b) - latest(a)
    })
  }, [reportCards])

  const isStaff = viewerProfile ? isStaffRole(viewerProfile.role) : false
  const isSelf  = viewerProfile?.id === studentId

  // Access guard — students can only view their own record
  useEffect(() => {
    if (!viewerProfile) return
    if (!isSelf && !isStaff) router.replace('/')
  }, [viewerProfile, isSelf, isStaff, router])

  // Feeds the "recently opened" report-card digest on Academics. Recorded
  // after the guard above, so a redirected visit never counts as an open.
  useEffect(() => {
    if (!viewerProfile || !isStaff || isSelf) return
    recordReportCardVisit(viewerProfile.id, studentId)
  }, [viewerProfile, isStaff, isSelf, studentId])

  return (
    <ProtectedLayout>
      <div data-page-theme="academics" className="min-h-screen bg-slate-50">

        {/* ── Top bar ── */}
        <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors flex-shrink-0"
            >
              <ArrowLeft size={18} />
            </button>
            {loadingStudent ? (
              <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
            ) : student ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar avatarUrl={student.avatar_url} name={student.full_name} size={32} userId={studentId} />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate leading-tight">{student.full_name}</p>
                  <p className="text-xs text-slate-400 leading-tight">
                    {student.grade ? `Grade ${student.grade}` : ''}
                    {student.grade && student.section ? ` · ${student.section}` : student.section ?? ''}
                    {' · '}Academic Record
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Academic Record</p>
            )}
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

          {loadingStudent ? (
            <div className="flex justify-center py-16">
              <Loader2 size={24} className="animate-spin text-slate-300" />
            </div>
          ) : !student ? (
            <div className="text-center py-20 text-slate-400">
              <FileText size={36} className="mx-auto mb-3 opacity-40" />
              <p>Student not found.</p>
            </div>
          ) : (
            <>
              {/* ── Academic year tabs ── */}
              {years.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Academic Year</span>
                  <div className="flex flex-wrap gap-1.5">
                    {years.map(year => (
                      <button
                        key={year}
                        onClick={() => setSelectedYear(year)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                          selectedYear === year
                            ? 'bg-slate-700 text-white border-slate-700 shadow-sm'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-800'
                        }`}
                      >
                        AY {year}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Report cards for selected year ── */}
              {loadingCards ? (
                <div className="flex justify-center py-16 gap-2 text-slate-400">
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-sm">Loading report cards…</span>
                </div>
              ) : sortedEntries.length === 0 ? (
                <div className="text-center py-20">
                  <FileText size={36} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-sm text-slate-500 font-medium">No report cards yet</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {years.length === 0
                      ? 'The student has no classrooms with report card data.'
                      : `No assessments tagged with a report card title for AY ${selectedYear}.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {sortedEntries.map(([title, entries]) => (
                    <ReportCardBlock
                      key={title}
                      title={title}
                      entries={entries}
                      student={student}
                      branding={branding}
                      remarks={remarks.filter(r => r.report_card_title === title)}
                      viewerId={viewerProfile!.id}
                      viewer={viewerProfile!}
                      canEditRemarks={isStaff}
                      onRemarksChanged={loadRemarks}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

// ─── Single report card block ──────────────────────────────────────────────────

interface SubjectRow {
  classroomId: string
  classroomTitle: string
  obtained: number
  max: number
  hasAnyMark: boolean
  assessments: StudentReportCardEntry[]
}

function ReportCardBlock({
  title, entries, student, branding, remarks, viewerId, viewer, canEditRemarks, onRemarksChanged,
}: {
  title: string
  entries: StudentReportCardEntry[]
  student: UserProfile
  branding: SiteBranding
  remarks: ReportCardRemark[]
  viewerId: string
  viewer: UserProfile
  canEditRemarks: boolean
  onRemarksChanged: () => void
}) {
  const subjects: SubjectRow[] = useMemo(() => {
    const map = new Map<string, SubjectRow>()
    for (const e of entries) {
      const row = map.get(e.classroom_id) ?? {
        classroomId: e.classroom_id,
        classroomTitle: e.classroom_title,
        obtained: 0, max: 0, hasAnyMark: false, assessments: [],
      }
      row.assessments.push(e)
      if (e.mark && e.mark.marks != null) {
        row.obtained += Number(e.mark.marks)
        row.max += Number(e.mark.max_marks)
        row.hasAnyMark = true
      }
      map.set(e.classroom_id, row)
    }
    return Array.from(map.values()).sort((a, b) => a.classroomTitle.localeCompare(b.classroomTitle))
  }, [entries])

  const totalObtained = subjects.reduce((s, r) => s + r.obtained, 0)
  const totalMax      = subjects.reduce((s, r) => s + r.max, 0)
  const overallPct    = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0
  const overallGrade  = gradeLetter(overallPct)

  // Components rolled up by name across every subject — how the student did on
  // each part of the split overall, not just assessment by assessment.
  const componentRollup = useMemo(() => componentTotals(entries), [entries])

  const dates = entries.map(e => e.assessment.date).filter((d): d is string => !!d).sort()

  return (
    <div className="-mx-2 sm:mx-0 rounded-none sm:rounded-2xl border-y sm:border border-slate-200 bg-white overflow-hidden sm:shadow-sm">

      {/* Header */}
      <div className="relative bg-gradient-to-br from-slate-600 to-slate-700 px-3 py-3 sm:px-6 sm:py-5 text-white">
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id={`rcp-${title.replace(/[^a-z0-9]/gi, '')}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.2" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#rcp-${title.replace(/[^a-z0-9]/gi, '')})`} />
          </svg>
        </div>
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex items-start gap-2.5 sm:gap-4">
          <div className="p-1.5 sm:p-2.5 bg-white/10 rounded-xl sm:rounded-2xl border border-white/15 flex-shrink-0">
            <GraduationCap size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-semibold">
              {branding.tagline || 'Report Card'}
            </p>
            <h3 className="text-base sm:text-xl font-bold tracking-tight leading-tight mt-0.5">
              {branding.schoolName || 'Report Card'}
            </h3>
            <p className="text-xs sm:text-sm text-white/70 mt-1 sm:mt-1.5 font-medium flex items-center gap-1.5">
              <Bookmark size={12} className="opacity-70" /> {title}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg border border-white/15 text-white/80 hover:text-white text-xs font-medium transition-colors print:hidden"
          >
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      {/* Student info strip */}
      <div className="px-3 py-2.5 sm:px-6 sm:py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 sm:gap-4 text-xs">
        <InfoField label="Student">{student.full_name}</InfoField>
        <InfoField label="Email"><span className="truncate block">{student.email}</span></InfoField>
        <InfoField label="Class">
          {student.grade ? `Grade ${student.grade}` : '—'}
          {student.section ? ` · ${student.section}` : ''}
        </InfoField>
        <InfoField label="Period">
          {dates.length > 0
            ? `${formatShortDate(dates[0])} – ${formatShortDate(dates[dates.length - 1])}`
            : '—'}
        </InfoField>
      </div>

      {/* Subjects table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] sm:text-sm">
          <thead>
            <tr className="bg-slate-50 border-b-2 border-slate-200">
              <th className="text-left px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[9px] sm:text-[11px]">Subject</th>
              <th className="text-left px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[9px] sm:text-[11px]">Assessments</th>
              <th className="text-center px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[9px] sm:text-[11px] whitespace-nowrap">Marks</th>
              <th className="hidden sm:table-cell text-center px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[9px] sm:text-[11px] whitespace-nowrap">Out of</th>
              <th className="text-center px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[9px] sm:text-[11px]">%</th>
              <th className="text-center px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[9px] sm:text-[11px]">Grade</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((row, idx) => {
              const pct   = row.max > 0 ? (row.obtained / row.max) * 100 : null
              const grade = pct != null ? gradeLetter(pct) : null
              return (
                <tr key={row.classroomId} className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-50 transition-colors`}>
                  <td className="px-2 py-2 sm:px-4 sm:py-3 align-top">
                    <p className="font-semibold text-slate-800">{row.classroomTitle}</p>
                  </td>
                  <td className="px-2 py-2 sm:px-4 sm:py-3 align-top">
                    <AssessmentBreakdown entries={row.assessments} />
                  </td>
                  <td className="px-2 py-2 sm:px-4 sm:py-3 text-center align-top font-bold text-slate-800 tabular-nums">
                    {row.hasAnyMark ? row.obtained : '—'}
                    {row.hasAnyMark && (
                      <span className="sm:hidden font-normal text-slate-400">/{row.max}</span>
                    )}
                  </td>
                  <td className="hidden sm:table-cell px-2 py-2 sm:px-4 sm:py-3 text-center align-top text-slate-500 tabular-nums">
                    {row.hasAnyMark ? row.max : '—'}
                  </td>
                  <td className="px-2 py-2 sm:px-4 sm:py-3 text-center align-top tabular-nums font-semibold text-slate-700">
                    {pct != null ? `${pct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-2 py-2 sm:px-4 sm:py-3 text-center align-top">
                    {grade ? (
                      <span className={`inline-block min-w-[34px] px-2 py-0.5 rounded-md text-xs font-bold ${grade.bg} ${grade.fg}`}>
                        {grade.letter}
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="px-2 py-2 sm:px-4 sm:py-3 font-bold text-slate-700 text-[11px] sm:text-sm uppercase tracking-wide" colSpan={2}>Total</td>
              <td className="px-2 py-2 sm:px-4 sm:py-3 text-center font-bold text-slate-800 tabular-nums">
                {totalMax > 0 ? totalObtained : '—'}
                {totalMax > 0 && <span className="sm:hidden font-normal text-slate-400">/{totalMax}</span>}
              </td>
              <td className="hidden sm:table-cell px-2 py-2 sm:px-4 sm:py-3 text-center font-bold text-slate-800 tabular-nums">{totalMax > 0 ? totalMax : '—'}</td>
              <td className="px-2 py-2 sm:px-4 sm:py-3 text-center font-bold text-slate-700 tabular-nums">{totalMax > 0 ? `${overallPct.toFixed(1)}%` : '—'}</td>
              <td className="px-2 py-2 sm:px-4 sm:py-3 text-center">
                {totalMax > 0 ? (
                  <span className={`inline-block min-w-[34px] px-2 py-0.5 rounded-md text-xs font-bold ${overallGrade.bg} ${overallGrade.fg}`}>
                    {overallGrade.letter}
                  </span>
                ) : <span className="text-slate-400">—</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Component roll-up */}
      {componentRollup.length > 0 && (
        <div className="px-3 py-2.5 sm:px-6 sm:py-3 bg-slate-50/70 border-t border-slate-200">
          <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
            Component Totals
          </p>
          <div className="flex flex-wrap gap-2">
            {componentRollup.map(c => {
              const pct = c.max > 0 ? (c.obtained / c.max) * 100 : 0
              const g = gradeLetter(pct)
              return (
                <div
                  key={c.name}
                  className="flex items-baseline gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5"
                >
                  <span className="text-xs font-semibold text-slate-700">{c.name}</span>
                  <span className="text-sm font-bold text-slate-800 tabular-nums">
                    {c.obtained}<span className="text-slate-400 font-medium">/{c.max}</span>
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${g.bg} ${g.fg}`}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Overall strip */}
      {totalMax > 0 && (
        <div className="px-3 py-2.5 sm:px-6 sm:py-3 bg-white border-t border-slate-100 flex items-center gap-x-3 gap-y-1.5 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Award size={12} className="text-slate-400" /> Overall:
            <span className="font-bold text-slate-800">{overallPct.toFixed(2)}%</span>
            <span className={`ml-1 px-2 py-0.5 rounded-md font-bold ${overallGrade.bg} ${overallGrade.fg}`}>
              {overallGrade.letter}
            </span>
          </div>
          <div className="text-xs text-slate-400">
            {subjects.length} subject{subjects.length === 1 ? '' : 's'} · {entries.length} assessment{entries.length === 1 ? '' : 's'}
          </div>
          <div className="ml-auto text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
            {overallPct >= 33 ? 'Result · Pass' : 'Result · Needs Improvement'}
          </div>
        </div>
      )}

      {/* Remarks */}
      <RemarksBlock
        remarks={remarks}
        studentId={student.id}
        reportCardTitle={title}
        viewerId={viewerId}
        viewer={viewer}
        canEdit={canEditRemarks}
        onChanged={onRemarksChanged}
      />
    </div>
  )
}

// ─── Remarks block ─────────────────────────────────────────────────────────────

function RemarksBlock({
  remarks, studentId, reportCardTitle, viewerId, viewer, canEdit, onChanged,
}: {
  remarks: ReportCardRemark[]
  studentId: string
  reportCardTitle: string
  viewerId: string
  viewer: UserProfile
  canEdit: boolean
  onChanged: () => void
}) {
  const myRemark = remarks.find(r => r.author_id === viewerId)
  const others   = remarks.filter(r => r.author_id !== viewerId)

  const [draft,      setDraft]      = useState(myRemark?.remark ?? '')
  const [saving,     setSaving]     = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [editing,    setEditing]    = useState(false)

  useEffect(() => { setDraft(myRemark?.remark ?? '') }, [myRemark?.remark])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    await upsertRemark(studentId, reportCardTitle, viewerId, draft)
    setSaving(false); setSavedFlash(true); setEditing(false)
    setTimeout(() => setSavedFlash(false), 1800)
    onChanged()
  }

  const handleDelete = async () => {
    if (!myRemark || !confirm('Delete your remark?')) return
    setSaving(true)
    await deleteRemark(myRemark.id)
    setSaving(false); setDraft(''); setEditing(false)
    onChanged()
  }

  return (
    <div className="px-3 py-3 sm:px-5 sm:py-4 bg-slate-50 border-t border-slate-200">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={13} className="text-slate-500" />
        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-600">Remarks</h4>
        <span className="text-[10px] text-slate-400">
          {remarks.length} {remarks.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>

      {others.length > 0 && (
        <div className="space-y-2 mb-3">
          {others.map(r => <RemarkBubble key={r.id} remark={r} />)}
        </div>
      )}

      {canEdit ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {!editing && myRemark ? (
            <div>
              <RemarkBubble remark={myRemark} self />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => setEditing(true)} className="text-xs text-slate-600 hover:text-slate-900 font-medium transition-colors">Edit</button>
                <button onClick={handleDelete} disabled={saving} className="text-xs text-slate-400 hover:text-rose-500 font-medium flex items-center gap-1 disabled:opacity-60 transition-colors">
                  <Trash2 size={11} /> Delete
                </button>
                {savedFlash && <span className="text-xs text-slate-500 font-medium">Saved ✓</span>}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Avatar avatarUrl={viewer.avatar_url} name={viewer.full_name ?? 'You'} size={26} userId={viewerId} />
                <p className="text-xs font-semibold text-slate-700">{viewer.full_name ?? 'Your remark'}</p>
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full uppercase tracking-wide font-bold">
                  {viewer.role ?? 'Staff'}
                </span>
              </div>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder={`Add a remark for ${reportCardTitle}…`}
                rows={3}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              />
              <div className="flex items-center gap-2 justify-end">
                {myRemark && (
                  <button onClick={() => { setEditing(false); setDraft(myRemark.remark) }} className="text-xs text-slate-500 hover:text-slate-700 font-medium">Cancel</button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !draft.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {saving ? 'Saving…' : myRemark ? 'Update remark' : 'Post remark'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        remarks.length === 0 && <p className="text-xs text-slate-400 italic">No remarks yet.</p>
      )}
    </div>
  )
}

function RemarkBubble({ remark, self = false }: { remark: ReportCardRemark; self?: boolean }) {
  const author = remark.author
  const date   = new Date(remark.updated_at || remark.created_at)
  return (
    <div className={`flex items-start gap-2.5 p-2.5 rounded-xl ${self ? 'bg-slate-100/70' : 'bg-white border border-slate-100'}`}>
      <Avatar avatarUrl={author?.avatar_url} name={author?.full_name ?? 'Staff'} size={28} userId={remark.author_id} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-xs font-semibold text-slate-700 truncate">{author?.full_name ?? 'Staff'}</p>
          {author?.role && (
            <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full uppercase tracking-wide font-bold">
              {author.role}
            </span>
          )}
          <span className="text-[10px] text-slate-400">
            {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap leading-relaxed">{remark.remark}</p>
      </div>
    </div>
  )
}

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold">{label}</p>
      <p className="text-sm font-medium text-slate-700 truncate mt-0.5">{children}</p>
    </div>
  )
}
