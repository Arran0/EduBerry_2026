'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown, FileText, Search, X, User as UserIcon, Bookmark,
  GraduationCap, MessageSquare, Save, Loader2, Trash2, Printer, Award,
} from 'lucide-react'
import {
  StudentReportCardEntry,
  ReportCardRemark,
  fetchReportCardsForStudent,
  fetchReportCardsForStudentAsViewer,
  searchStudentsForReportCard,
  fetchRemarksForStudent,
  upsertRemark,
  deleteRemark,
} from '@/lib/classrooms'
import { UserProfile, UserRole } from '@/lib/supabase'
import { fetchBranding, SiteBranding, BRANDING_DEFAULTS } from '@/lib/pageConfig'
import Avatar from '@/components/Avatar'

interface ReportCardsSectionProps {
  user: { id: string }
  profile: UserProfile
  isStudent: boolean
}

/** Top-level expandable section that lives on the academics page. Renders a
 *  CBSE-style report card view for the current student, or a search bar for
 *  staff to look up students they share at least one classroom with. */
export default function ReportCardsSection({ user, profile, isStudent }: ReportCardsSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [branding, setBranding] = useState<SiteBranding>(BRANDING_DEFAULTS)

  useEffect(() => {
    fetchBranding().then(setBranding).catch(() => {})
  }, [])

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center px-4 py-3 hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex-1 flex items-center gap-2 text-left">
          <div className="p-1.5 bg-indigo-100 rounded-lg">
            <FileText size={14} className="text-indigo-600" />
          </div>
          <h2 className="font-semibold text-slate-700 text-sm">
            {isStudent ? 'My Report Cards' : 'Report Cards'}
          </h2>
          <span className="text-xs text-slate-400 font-normal">
            · {isStudent ? 'Marks grouped by report card title' : 'Search students sharing your classrooms'}
          </span>
        </div>
        <ChevronDown
          size={18}
          className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-t border-slate-100"
          >
            <div className="p-4">
              {isStudent ? (
                <ReportCardForStudent
                  studentProfile={profile}
                  viewerId={user.id}
                  viewerRole={profile.role}
                  branding={branding}
                  selfView
                />
              ) : (
                <StaffReportCardSearch
                  viewerId={user.id}
                  viewerRole={profile.role}
                  viewer={profile}
                  branding={branding}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ─── Staff search wrapper ─────────────────────────────────────────────────────

function StaffReportCardSearch({
  viewerId, viewerRole, viewer, branding,
}: {
  viewerId: string
  viewerRole: UserRole
  viewer: UserProfile
  branding: SiteBranding
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserProfile[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<UserProfile | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) { setResults([]); return }
    setSearching(true)
    const timer = setTimeout(async () => {
      const r = await searchStudentsForReportCard(viewerId, viewerRole, q, 12)
      setResults(r)
      setSearching(false)
    }, 220)
    return () => clearTimeout(timer)
  }, [query, viewerId, viewerRole])

  if (selected) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setSelected(null)}
          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
        >
          ← Back to search
        </button>
        <ReportCardForStudent
          studentProfile={selected}
          viewerId={viewerId}
          viewerRole={viewerRole}
          viewer={viewer}
          branding={branding}
          selfView={false}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-indigo-400/50">
        <Search size={16} className="text-slate-400 flex-shrink-0" />
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            viewerRole === 'admin' || viewerRole === 'principal'
              ? 'Search any student by name or email…'
              : 'Search students from your classrooms by name or email…'
          }
          className="flex-1 bg-transparent text-sm focus:outline-none text-slate-700 placeholder:text-slate-400"
        />
        {searching && <Loader2 size={14} className="text-slate-400 animate-spin" />}
        {query && !searching && (
          <button onClick={() => { setQuery(''); inputRef.current?.focus() }} className="text-slate-300 hover:text-slate-500">
            <X size={13} />
          </button>
        )}
      </div>

      {query.trim() && results.length === 0 && !searching && (
        <div className="text-center py-10 text-sm text-slate-400">
          No students match &ldquo;{query.trim()}&rdquo;
          {viewerRole !== 'admin' && viewerRole !== 'principal' && (
            <p className="text-xs text-slate-300 mt-1">
              Only students sharing a classroom with you can be searched.
            </p>
          )}
        </div>
      )}

      {!query.trim() && (
        <div className="text-center py-10">
          <UserIcon size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">Search for a student to view their report cards</p>
          {viewerRole !== 'admin' && viewerRole !== 'principal' && (
            <p className="text-xs text-slate-400 mt-1">
              You can only see students from classrooms you&apos;re a member of.
            </p>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {results.map(s => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-white border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors text-left"
            >
              <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={36} userId={s.id} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-700 truncate">{s.full_name}</p>
                <p className="text-xs text-slate-400 truncate">{s.email}</p>
              </div>
              {(s.grade || s.section) && (
                <span className="text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-medium">
                  {s.grade ? `Grade ${s.grade}` : ''}{s.grade && s.section ? ' · ' : ''}{s.section ?? ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Report card view (used by student self-view + staff lookup) ──────────────

interface ReportCardForStudentProps {
  studentProfile: UserProfile
  viewerId: string
  viewerRole: UserRole
  viewer?: UserProfile
  branding: SiteBranding
  selfView: boolean
}

function ReportCardForStudent({
  studentProfile, viewerId, viewerRole, viewer, branding, selfView,
}: ReportCardForStudentProps) {
  const [groups, setGroups] = useState<Map<string, StudentReportCardEntry[]> | null>(null)
  const [remarks, setRemarks] = useState<ReportCardRemark[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [g, r] = await Promise.all([
      selfView
        ? fetchReportCardsForStudent(studentProfile.id)
        : fetchReportCardsForStudentAsViewer(studentProfile.id, viewerId, viewerRole),
      fetchRemarksForStudent(studentProfile.id),
    ])
    setGroups(g)
    setRemarks(r)
    setLoading(false)
  }, [studentProfile.id, viewerId, viewerRole, selfView])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-500">Loading report cards…</p>
      </div>
    )
  }

  if (!groups || groups.size === 0) {
    return (
      <div className="text-center py-10">
        <FileText size={32} className="text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No report cards yet</p>
        <p className="text-xs text-slate-400 mt-1">
          Assessments tagged with a report card title will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {Array.from(groups.entries()).map(([title, entries]) => (
        <ReportCard
          key={title}
          title={title}
          entries={entries}
          studentProfile={studentProfile}
          remarks={remarks.filter(r => r.report_card_title === title)}
          viewerId={viewerId}
          viewer={viewer}
          canEditRemarks={!selfView}
          branding={branding}
          onRemarksChanged={load}
        />
      ))}
    </div>
  )
}

// ─── Single report card (CBSE-style) ──────────────────────────────────────────

interface ReportCardProps {
  title: string
  entries: StudentReportCardEntry[]
  studentProfile: UserProfile
  remarks: ReportCardRemark[]
  viewerId: string
  viewer?: UserProfile
  canEditRemarks: boolean
  branding: SiteBranding
  onRemarksChanged: () => void
}

function gradeLetter(pct: number): { letter: string; bg: string; fg: string } {
  if (pct >= 91) return { letter: 'A1', bg: 'bg-emerald-100', fg: 'text-emerald-700' }
  if (pct >= 81) return { letter: 'A2', bg: 'bg-emerald-100', fg: 'text-emerald-700' }
  if (pct >= 71) return { letter: 'B1', bg: 'bg-green-100',   fg: 'text-green-700'   }
  if (pct >= 61) return { letter: 'B2', bg: 'bg-lime-100',    fg: 'text-lime-700'    }
  if (pct >= 51) return { letter: 'C1', bg: 'bg-amber-100',   fg: 'text-amber-700'   }
  if (pct >= 41) return { letter: 'C2', bg: 'bg-orange-100',  fg: 'text-orange-700'  }
  if (pct >= 33) return { letter: 'D',  bg: 'bg-rose-100',    fg: 'text-rose-700'    }
  return { letter: 'E', bg: 'bg-red-100', fg: 'text-red-700' }
}

interface SubjectRow {
  classroomId: string
  classroomTitle: string
  obtained: number
  max: number
  hasAnyMark: boolean
  assessments: StudentReportCardEntry[]
}

function ReportCard({
  title, entries, studentProfile, remarks, viewerId, viewer, canEditRemarks,
  branding, onRemarksChanged,
}: ReportCardProps) {
  // Group entries by classroom (subject row).
  const subjects: SubjectRow[] = useMemo(() => {
    const map = new Map<string, SubjectRow>()
    for (const e of entries) {
      const row = map.get(e.classroom_id) ?? {
        classroomId: e.classroom_id,
        classroomTitle: e.classroom_title,
        obtained: 0,
        max: 0,
        hasAnyMark: false,
        assessments: [],
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
  const totalMax = subjects.reduce((s, r) => s + r.max, 0)
  const overallPct = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0
  const overallGrade = gradeLetter(overallPct)

  // Sort assessment dates to get reporting period.
  const dates = entries
    .map(e => e.assessment.date)
    .filter((d): d is string => !!d)
    .sort()
  const periodStart = dates[0]
  const periodEnd = dates[dates.length - 1]

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white overflow-hidden shadow-sm print:shadow-none">
      {/* Header */}
      <div className="relative bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 px-6 py-5 text-white">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id={`rc-${title.replace(/[^a-z0-9]/gi, '')}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#rc-${title.replace(/[^a-z0-9]/gi, '')})`} />
          </svg>
        </div>
        <div className="relative flex items-start gap-4">
          <div className="p-2.5 bg-white/15 backdrop-blur-sm rounded-2xl border border-white/20 flex-shrink-0">
            <GraduationCap size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/70 font-semibold">
              {branding.tagline || 'Report Card'}
            </p>
            <h3 className="text-lg sm:text-xl font-bold tracking-tight leading-tight mt-0.5">
              {branding.schoolName || 'Report Card'}
            </h3>
            <p className="text-sm text-white/80 mt-1.5 font-medium flex items-center gap-1.5">
              <Bookmark size={12} /> {title}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-lg border border-white/20 text-white text-xs font-medium transition-colors print:hidden"
            title="Print this report card"
          >
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      {/* Student strip */}
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Field label="Student">{studentProfile.full_name}</Field>
        <Field label="Email">
          <span className="truncate block">{studentProfile.email}</span>
        </Field>
        <Field label="Class">
          {studentProfile.grade ? `Grade ${studentProfile.grade}` : '—'}
          {studentProfile.section ? ` · ${studentProfile.section}` : ''}
        </Field>
        <Field label="Period">
          {periodStart && periodEnd
            ? `${formatShort(periodStart)} – ${formatShort(periodEnd)}`
            : '—'}
        </Field>
      </div>

      {/* Subjects table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-indigo-50 border-b-2 border-indigo-200">
              <th className="text-left px-4 py-2.5 font-semibold text-slate-700 uppercase tracking-wide text-[11px]">Subject</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-700 uppercase tracking-wide text-[11px]">Assessments</th>
              <th className="text-center px-4 py-2.5 font-semibold text-slate-700 uppercase tracking-wide text-[11px] whitespace-nowrap">Marks</th>
              <th className="text-center px-4 py-2.5 font-semibold text-slate-700 uppercase tracking-wide text-[11px] whitespace-nowrap">Out of</th>
              <th className="text-center px-4 py-2.5 font-semibold text-slate-700 uppercase tracking-wide text-[11px]">%</th>
              <th className="text-center px-4 py-2.5 font-semibold text-slate-700 uppercase tracking-wide text-[11px]">Grade</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map(row => {
              const pct = row.max > 0 ? (row.obtained / row.max) * 100 : null
              const grade = pct != null ? gradeLetter(pct) : null
              return (
                <tr key={row.classroomId} className="border-b border-slate-100 hover:bg-slate-50/40 transition-colors">
                  <td className="px-4 py-3 align-top">
                    <p className="font-semibold text-slate-800">{row.classroomTitle}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <ul className="space-y-1">
                      {row.assessments.map(a => {
                        const m = a.mark
                        const aPct = m && m.marks != null
                          ? Math.round((Number(m.marks) / Number(m.max_marks)) * 100)
                          : null
                        return (
                          <li key={a.assessment.id} className="text-xs text-slate-600 flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-indigo-300 flex-shrink-0" />
                            <span className="truncate flex-1">{a.assessment.title}</span>
                            <span className="text-slate-400 font-medium tabular-nums">
                              {m && m.marks != null
                                ? `${m.marks}/${m.max_marks}${aPct != null ? ` (${aPct}%)` : ''}`
                                : '—'}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </td>
                  <td className="px-4 py-3 text-center align-top font-bold text-slate-800 tabular-nums">
                    {row.hasAnyMark ? row.obtained : '—'}
                  </td>
                  <td className="px-4 py-3 text-center align-top text-slate-500 tabular-nums">
                    {row.hasAnyMark ? row.max : '—'}
                  </td>
                  <td className="px-4 py-3 text-center align-top tabular-nums font-semibold text-slate-700">
                    {pct != null ? `${pct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center align-top">
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
            <tr className="bg-gradient-to-r from-indigo-50 to-violet-50 border-t-2 border-indigo-200">
              <td className="px-4 py-3 font-bold text-slate-800 text-sm uppercase tracking-wide" colSpan={2}>Total</td>
              <td className="px-4 py-3 text-center font-bold text-slate-800 tabular-nums">
                {totalMax > 0 ? totalObtained : '—'}
              </td>
              <td className="px-4 py-3 text-center font-bold text-slate-800 tabular-nums">
                {totalMax > 0 ? totalMax : '—'}
              </td>
              <td className="px-4 py-3 text-center font-bold text-indigo-700 tabular-nums">
                {totalMax > 0 ? `${overallPct.toFixed(1)}%` : '—'}
              </td>
              <td className="px-4 py-3 text-center">
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

      {/* Result summary */}
      {totalMax > 0 && (
        <div className="px-6 py-3 bg-white border-t border-slate-100 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Award size={12} className="text-indigo-500" /> Overall:
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
      <RemarksPanel
        remarks={remarks}
        studentId={studentProfile.id}
        reportCardTitle={title}
        viewerId={viewerId}
        viewer={viewer}
        canEdit={canEditRemarks}
        onChanged={onRemarksChanged}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold">{label}</p>
      <p className="text-sm font-medium text-slate-700 truncate mt-0.5">{children}</p>
    </div>
  )
}

function formatShort(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

// ─── Remarks panel ────────────────────────────────────────────────────────────

interface RemarksPanelProps {
  remarks: ReportCardRemark[]
  studentId: string
  reportCardTitle: string
  viewerId: string
  viewer?: UserProfile
  canEdit: boolean
  onChanged: () => void
}

function RemarksPanel({
  remarks, studentId, reportCardTitle, viewerId, viewer, canEdit, onChanged,
}: RemarksPanelProps) {
  // The viewer's own remark (if any) is editable inline; others are read-only.
  const myRemark = remarks.find(r => r.author_id === viewerId)
  const others = remarks.filter(r => r.author_id !== viewerId)

  const [draft, setDraft] = useState(myRemark?.remark ?? '')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => { setDraft(myRemark?.remark ?? '') }, [myRemark?.remark])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    await upsertRemark(studentId, reportCardTitle, viewerId, draft)
    setSaving(false)
    setSavedFlash(true)
    setEditing(false)
    setTimeout(() => setSavedFlash(false), 1800)
    onChanged()
  }

  const handleDelete = async () => {
    if (!myRemark) return
    if (!confirm('Delete your remark?')) return
    setSaving(true)
    await deleteRemark(myRemark.id)
    setSaving(false)
    setDraft('')
    setEditing(false)
    onChanged()
  }

  return (
    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare size={13} className="text-indigo-500" />
        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-600">Remarks</h4>
        <span className="text-[10px] text-slate-400">
          {remarks.length} {remarks.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>

      {/* Existing remarks (everyone sees these) */}
      {others.length > 0 && (
        <div className="space-y-2 mb-3">
          {others.map(r => (
            <RemarkBubble key={r.id} remark={r} />
          ))}
        </div>
      )}

      {/* Viewer's own remark — staff can edit/add. Students see their own
          comments rendered above (rare, but harmless). */}
      {canEdit ? (
        <div className="rounded-xl border border-indigo-200 bg-white p-3">
          {!editing && myRemark ? (
            <div>
              <RemarkBubble remark={myRemark} self />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="text-xs text-rose-500 hover:text-rose-600 font-medium flex items-center gap-1 disabled:opacity-60"
                >
                  <Trash2 size={11} /> Delete
                </button>
                {savedFlash && (
                  <span className="text-xs text-emerald-600 font-medium">Saved ✓</span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Avatar avatarUrl={viewer?.avatar_url} name={viewer?.full_name ?? 'You'} size={26} userId={viewerId} />
                <p className="text-xs font-semibold text-slate-700">{viewer?.full_name ?? 'Your remark'}</p>
                <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full uppercase tracking-wide font-bold">
                  {viewer?.role ?? 'Staff'}
                </span>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Add a remark for ${reportCardTitle}…`}
                rows={3}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50 resize-none"
              />
              <div className="flex items-center gap-2">
                <div className="flex-1" />
                {myRemark && (
                  <button
                    onClick={() => { setEditing(false); setDraft(myRemark.remark) }}
                    className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !draft.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {saving ? 'Saving…' : myRemark ? 'Update remark' : 'Post remark'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        remarks.length === 0 && (
          <p className="text-xs text-slate-400 italic">No remarks yet.</p>
        )
      )}
    </div>
  )
}

function RemarkBubble({ remark, self = false }: { remark: ReportCardRemark; self?: boolean }) {
  const author = remark.author
  const date = new Date(remark.updated_at || remark.created_at)
  return (
    <div className={`flex items-start gap-2.5 p-2.5 rounded-xl ${self ? 'bg-indigo-50/60' : 'bg-white border border-slate-100'}`}>
      <Avatar avatarUrl={author?.avatar_url} name={author?.full_name ?? 'Staff'} size={28} userId={remark.author_id} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-xs font-semibold text-slate-700 truncate">
            {author?.full_name ?? 'Staff'}
          </p>
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
