'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown, ChevronUp, FileText, Search, X, User as UserIcon, Bookmark,
  GraduationCap, MessageSquare, Save, Loader2, Trash2, Printer, Award,
  LayoutGrid, Download, Table2, ArrowUpDown, CalendarRange,
} from 'lucide-react'
import {
  StudentReportCardEntry,
  ReportCardRemark,
  fetchReportCardsForStudent,
  fetchReportCardsForStudentAsViewer,
  fetchAvailableAcademicYearsForStudent,
  searchStudentsForReportCard,
  fetchRemarksForStudent,
  upsertRemark,
  deleteRemark,
  fetchAllReportCardTitles,
  fetchGradeSectionsWithStudents,
  fetchClasswiseMarks,
  ClasswiseSubject,
  ClasswiseCellData,
} from '@/lib/classrooms'
import { UserProfile, UserRole } from '@/lib/supabase'
import { fetchBranding, SiteBranding, BRANDING_DEFAULTS } from '@/lib/pageConfig'
import Avatar from '@/components/Avatar'

// ─── Grade colour palette — green → yellow → orange → red ────────────────────
function gradeLetter(pct: number): { letter: string; bg: string; fg: string } {
  if (pct >= 91) return { letter: 'A1', bg: 'bg-emerald-100', fg: 'text-emerald-700' }
  if (pct >= 81) return { letter: 'A2', bg: 'bg-green-100',   fg: 'text-green-700'   }
  if (pct >= 71) return { letter: 'B1', bg: 'bg-lime-100',    fg: 'text-lime-700'    }
  if (pct >= 61) return { letter: 'B2', bg: 'bg-yellow-100',  fg: 'text-yellow-700'  }
  if (pct >= 51) return { letter: 'C1', bg: 'bg-amber-100',   fg: 'text-amber-700'   }
  if (pct >= 41) return { letter: 'C2', bg: 'bg-orange-100',  fg: 'text-orange-700'  }
  if (pct >= 33) return { letter: 'D',  bg: 'bg-red-100',     fg: 'text-red-600'     }
  return               { letter: 'E',  bg: 'bg-red-100',     fg: 'text-red-700'     }
}

// ─── Congratulations messages (auto-rotated by student + title hash) ──────────
const CONGRATS_MESSAGES = [
  {
    headline: 'Outstanding Performance!',
    sub: 'Exceptional dedication and hard work have led to these brilliant results. Well done!',
  },
  {
    headline: 'Brilliant Achievement!',
    sub: 'Your commitment to excellence is truly reflected in these remarkable grades. Keep it up!',
  },
  {
    headline: 'Excellent Results!',
    sub: 'A wonderful performance this term — your talent and effort are clearly paying off.',
  },
  {
    headline: 'Top of the Class!',
    sub: 'An impressive and well-earned achievement. You should be very proud of yourself.',
  },
  {
    headline: 'Stellar Performance!',
    sub: 'Outstanding grades that speak volumes about your diligence and passion for learning.',
  },
  {
    headline: 'Wonderful Grades!',
    sub: 'Your perseverance and focus have produced truly commendable results this term.',
  },
]

function pickCongrats(seed: string) {
  const idx = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % CONGRATS_MESSAGES.length
  return CONGRATS_MESSAGES[idx]
}

// ─── Props / main section ─────────────────────────────────────────────────────

interface ReportCardsSectionProps {
  user: { id: string }
  profile: UserProfile
  isStudent: boolean
}

export default function ReportCardsSection({ user, profile, isStudent }: ReportCardsSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [branding, setBranding] = useState<SiteBranding>(BRANDING_DEFAULTS)

  useEffect(() => {
    fetchBranding().then(setBranding).catch(() => {})
  }, [])

  return (
    <section>
      {/* ── Section header — mirrors the other academics headers exactly ── */}
      <div className="flex items-center justify-between gap-3 mb-4 min-h-[2.5rem]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="icon-chip w-10 h-10 flex-shrink-0 bg-gradient-to-br from-rose-400 to-pink-600">
            <Award size={18} className="relative z-10 text-white drop-shadow-sm" />
          </div>
          <h2 className="font-display text-[1.4rem] font-bold leading-none headline text-slate-900 truncate">
            Report Cards
          </h2>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 pl-4 pr-3 py-2 rounded-full text-sm font-semibold border shadow-sm transition-all active:scale-95 ${
            expanded
              ? 'bg-rose-500 text-white border-rose-500'
              : 'bg-white/80 text-slate-600 border-white/70 hover:text-rose-600 hover:border-rose-200'
          }`}
        >
          {expanded ? 'Close' : 'View'}
          <ChevronDown size={16} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* ── Jelly-expanding white card ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="rc-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 210, damping: 24, mass: 0.9 }}
            className="overflow-hidden"
          >
            <motion.div
              initial={{ scale: 0.95, y: -8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.97, y: -4 }}
              transition={{ type: 'spring', stiffness: 320, damping: 19, mass: 0.8 }}
              className="glass-card rounded-[1.5rem] p-4 sm:p-5 origin-top"
            >
              {isStudent ? (
                <ReportCardForStudent
                  studentProfile={profile}
                  viewerId={user.id}
                  viewerRole={profile.role}
                  branding={branding}
                  selfView
                />
              ) : (
                <StaffReportCardView
                  viewerId={user.id}
                  viewerRole={profile.role}
                  viewer={profile}
                  branding={branding}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ─── Staff view: tab toggle between individual search and class-wide matrix ───

type StaffTab = 'individual' | 'classwise'

function StaffReportCardView({
  viewerId, viewerRole, viewer, branding,
}: {
  viewerId: string
  viewerRole: UserRole
  viewer: UserProfile
  branding: SiteBranding
}) {
  const [tab, setTab] = useState<StaffTab>('individual')

  return (
    <div className="space-y-4">
      {/* Tab toggle */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        <button
          onClick={() => setTab('individual')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            tab === 'individual'
              ? 'bg-white shadow text-slate-800'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <UserIcon size={12} /> Individual
        </button>
        <button
          onClick={() => setTab('classwise')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            tab === 'classwise'
              ? 'bg-white shadow text-slate-800'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Table2 size={12} /> Class Marks
        </button>
      </div>

      {tab === 'individual' ? (
        <StaffReportCardSearch
          viewerId={viewerId}
          viewerRole={viewerRole}
          viewer={viewer}
          branding={branding}
        />
      ) : (
        <ClasswiseMarksView />
      )}
    </div>
  )
}

// ─── Staff individual search ─────────────────────────────────────────────────

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
          className="text-xs text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1 transition-colors"
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
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-slate-300">
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
              className="flex items-center gap-3 p-2.5 rounded-xl bg-white border border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
            >
              <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={36} userId={s.id} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-700 truncate">{s.full_name}</p>
                <p className="text-xs text-slate-400 truncate">{s.email}</p>
              </div>
              {(s.grade || s.section) && (
                <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-medium">
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

// ─── Class-wide Marks View ────────────────────────────────────────────────────

function downloadCSV(
  students: UserProfile[],
  subjects: ClasswiseSubject[],
  cellData: Record<string, Record<string, ClasswiseCellData>>,
  grade: number,
  section: string,
  reportCardTitle: string,
) {
  const headers = [
    'Student Name',
    'Email',
    'Grade',
    'Section',
    ...subjects.flatMap(s => [`${s.subject} (Obtained)`, `${s.subject} (Max)`, `${s.subject} (%)`]),
    'Overall Obtained',
    'Overall Max',
    'Overall %',
    'Overall Grade',
  ]

  const rows = students.map(student => {
    let totalObtained = 0
    let totalMax = 0
    const subjectCells = subjects.map(s => {
      const cell = cellData[student.id]?.[s.classroomId]
      if (cell?.hasAnyMark) {
        totalObtained += cell.obtained
        totalMax += cell.max
        const pct = cell.max > 0 ? (cell.obtained / cell.max) * 100 : 0
        return [String(cell.obtained), String(cell.max), pct.toFixed(1)]
      }
      return ['—', '—', '—']
    })
    const overallPct = totalMax > 0 ? (totalObtained / totalMax) * 100 : null
    const grade_ = overallPct != null ? gradeLetter(overallPct).letter : '—'
    return [
      student.full_name,
      student.email,
      String(grade),
      section,
      ...subjectCells.flat(),
      totalMax > 0 ? String(totalObtained) : '—',
      totalMax > 0 ? String(totalMax) : '—',
      overallPct != null ? `${overallPct.toFixed(1)}` : '—',
      grade_,
    ]
  })

  const csvLines = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  )
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Class_Marks_Grade${grade}${section}_${reportCardTitle.replace(/\s+/g, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function ClasswiseMarksView() {
  const [gradeSections, setGradeSections] = useState<{ grade: number; section: string }[]>([])
  const [allTitles, setAllTitles] = useState<string[]>([])
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null)
  const [selectedSection, setSelectedSection] = useState<string>('')
  const [selectedTitle, setSelectedTitle] = useState<string>('')

  const [loading, setLoading] = useState(false)
  const [students, setStudents] = useState<UserProfile[]>([])
  const [subjects, setSubjects] = useState<ClasswiseSubject[]>([])
  const [cellData, setCellData] = useState<Record<string, Record<string, ClasswiseCellData>>>({})
  const [loaded, setLoaded] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'marks'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    fetchGradeSectionsWithStudents().then(setGradeSections)
    fetchAllReportCardTitles().then(setAllTitles)
  }, [])

  const availableGrades = useMemo(
    () => [...new Set(gradeSections.map(gs => gs.grade))].sort((a, b) => a - b),
    [gradeSections]
  )

  const availableSections = useMemo(
    () => selectedGrade != null
      ? gradeSections.filter(gs => gs.grade === selectedGrade).map(gs => gs.section)
      : [],
    [gradeSections, selectedGrade]
  )

  const handleGradeChange = (g: number | null) => {
    setSelectedGrade(g); setSelectedSection(''); setSelectedTitle(''); setLoaded(false)
  }
  const handleSectionChange = (s: string) => {
    setSelectedSection(s); setSelectedTitle(''); setLoaded(false)
  }
  const handleTitleChange = (t: string) => {
    setSelectedTitle(t); setLoaded(false)
  }

  const canLoad = selectedGrade != null && selectedSection !== '' && selectedTitle !== ''

  const handleLoad = useCallback(async () => {
    if (!canLoad) return
    setLoading(true)
    const result = await fetchClasswiseMarks(selectedGrade!, selectedSection, selectedTitle)
    setStudents(result.students)
    setSubjects(result.subjects)
    setCellData(result.cellData)
    setLoaded(true)
    setLoading(false)
  }, [canLoad, selectedGrade, selectedSection, selectedTitle])

  const columnStats = useMemo(() => {
    return subjects.map(s => {
      let sumObtained = 0; let sumMax = 0; let count = 0
      for (const student of students) {
        const cell = cellData[student.id]?.[s.classroomId]
        if (cell?.hasAnyMark && cell.max > 0) {
          sumObtained += cell.obtained; sumMax += cell.max; count++
        }
      }
      const avgPct = sumMax > 0 ? (sumObtained / sumMax) * 100 : null
      return { sumObtained, sumMax, avgPct, count }
    })
  }, [subjects, students, cellData])

  const overallStat = useMemo(() => {
    let sumObtained = 0; let sumMax = 0
    for (const student of students) {
      for (const s of subjects) {
        const cell = cellData[student.id]?.[s.classroomId]
        if (cell?.hasAnyMark) { sumObtained += cell.obtained; sumMax += cell.max }
      }
    }
    const pct = sumMax > 0 ? (sumObtained / sumMax) * 100 : null
    return { sumObtained, sumMax, pct }
  }, [subjects, students, cellData])

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
      if (sortBy === 'name') {
        const cmp = a.full_name.localeCompare(b.full_name)
        return sortDir === 'asc' ? cmp : -cmp
      }
      let aObt = 0, aMax = 0, bObt = 0, bMax = 0
      subjects.forEach(s => {
        const ca = cellData[a.id]?.[s.classroomId]
        const cb = cellData[b.id]?.[s.classroomId]
        if (ca?.hasAnyMark) { aObt += ca.obtained; aMax += ca.max }
        if (cb?.hasAnyMark) { bObt += cb.obtained; bMax += cb.max }
      })
      const aPct = aMax > 0 ? aObt / aMax : -1
      const bPct = bMax > 0 ? bObt / bMax : -1
      return sortDir === 'asc' ? aPct - bPct : bPct - aPct
    })
  }, [students, cellData, subjects, sortBy, sortDir])

  const toggleSort = (field: 'name' | 'marks') => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  return (
    <div className="space-y-4">
      {/* Cascade selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Grade</label>
          <select
            value={selectedGrade ?? ''}
            onChange={e => handleGradeChange(e.target.value !== '' ? Number(e.target.value) : null)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700"
          >
            <option value="">Select grade…</option>
            {availableGrades.map(g => (
              <option key={g} value={g}>Grade {g}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Section</label>
          <select
            value={selectedSection}
            onChange={e => handleSectionChange(e.target.value)}
            disabled={selectedGrade == null}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">Select section…</option>
            {availableSections.map(sec => (
              <option key={sec} value={sec}>Section {sec}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Report Card</label>
          <select
            value={selectedTitle}
            onChange={e => handleTitleChange(e.target.value)}
            disabled={selectedSection === ''}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">Select report card…</option>
            {allTitles.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleLoad}
          disabled={!canLoad || loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <LayoutGrid size={14} />}
          {loading ? 'Loading…' : 'Load Marks'}
        </button>

        {loaded && subjects.length > 0 && (
          <button
            onClick={() => downloadCSV(students, subjects, cellData, selectedGrade!, selectedSection, selectedTitle)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition-colors"
          >
            <Download size={14} /> Download CSV
          </button>
        )}
      </div>

      {/* Results */}
      {loaded && !loading && (
        <>
          {students.length === 0 ? (
            <div className="text-center py-10">
              <UserIcon size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No students found for Grade {selectedGrade} · {selectedSection}</p>
            </div>
          ) : subjects.length === 0 ? (
            <div className="text-center py-10">
              <FileText size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No classrooms with a subject set have assessments under &ldquo;{selectedTitle}&rdquo; for Grade {selectedGrade} · {selectedSection}</p>
              <p className="text-xs text-slate-400 mt-1">Set a subject on classrooms in Classroom Management to see them here.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              {/* Summary strip */}
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-4 flex-wrap text-xs">
                <span className="font-bold text-slate-800">Grade {selectedGrade} · Section {selectedSection}</span>
                <span className="text-slate-500">{selectedTitle}</span>
                <span className="text-slate-400">{students.length} student{students.length !== 1 ? 's' : ''} · {subjects.length} subject{subjects.length !== 1 ? 's' : ''}</span>
                {overallStat.pct != null && (
                  <span className="ml-auto flex items-center gap-1.5 font-semibold text-slate-700">
                    <Award size={12} />
                    Class avg {overallStat.pct.toFixed(1)}%
                    <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${gradeLetter(overallStat.pct).bg} ${gradeLetter(overallStat.pct).fg}`}>
                      {gradeLetter(overallStat.pct).letter}
                    </span>
                  </span>
                )}
              </div>

              {/* Matrix table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="sticky left-0 bg-slate-50 text-left px-4 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px] whitespace-nowrap z-10 border-r border-slate-200 min-w-[160px]">
                        <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-slate-800 transition-colors">
                          Student
                          {sortBy === 'name'
                            ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
                            : <ArrowUpDown size={10} className="opacity-40" />}
                        </button>
                      </th>
                      {subjects.map(s => (
                        <th key={s.classroomId} className="text-center px-3 py-2.5 font-bold text-slate-600 uppercase tracking-wide text-[10px] whitespace-nowrap min-w-[110px]">
                          {s.subject}
                        </th>
                      ))}
                      <th className="text-center px-3 py-2.5 font-bold text-slate-700 uppercase tracking-wide text-[10px] whitespace-nowrap min-w-[110px] border-l border-slate-200">
                        <button onClick={() => toggleSort('marks')} className="flex items-center gap-1 mx-auto hover:text-slate-900 transition-colors">
                          Overall
                          {sortBy === 'marks'
                            ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
                            : <ArrowUpDown size={10} className="opacity-40" />}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStudents.map((student, idx) => {
                      let studentObtained = 0; let studentMax = 0
                      subjects.forEach(s => {
                        const cell = cellData[student.id]?.[s.classroomId]
                        if (cell?.hasAnyMark) { studentObtained += cell.obtained; studentMax += cell.max }
                      })
                      const overallPct = studentMax > 0 ? (studentObtained / studentMax) * 100 : null
                      const overallGrade = overallPct != null ? gradeLetter(overallPct) : null

                      return (
                        <tr key={student.id} className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-slate-50 transition-colors`}>
                          <td className="sticky left-0 bg-inherit px-4 py-2 border-r border-slate-200 z-10">
                            <div className="flex items-center gap-2">
                              <Avatar avatarUrl={student.avatar_url} name={student.full_name} size={24} userId={student.id} />
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-700 truncate text-[11px]">{student.full_name}</p>
                              </div>
                            </div>
                          </td>

                          {subjects.map(s => {
                            const cell = cellData[student.id]?.[s.classroomId]
                            if (!cell?.hasAnyMark) {
                              return <td key={s.classroomId} className="px-3 py-2 text-center text-slate-400">—</td>
                            }
                            const pct = cell.max > 0 ? (cell.obtained / cell.max) * 100 : 0
                            const g = gradeLetter(pct)
                            return (
                              <td key={s.classroomId} className="px-3 py-2 text-center">
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="font-bold text-slate-800 tabular-nums">{cell.obtained}/{cell.max}</span>
                                  <span className="text-slate-500 tabular-nums">{pct.toFixed(1)}%</span>
                                  <span className={`px-1.5 py-0 rounded text-[9px] font-bold ${g.bg} ${g.fg}`}>{g.letter}</span>
                                </div>
                              </td>
                            )
                          })}

                          <td className="px-3 py-2 text-center border-l border-slate-200">
                            {overallPct != null ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="font-bold text-slate-800 tabular-nums">{studentObtained}/{studentMax}</span>
                                <span className="font-semibold text-slate-700 tabular-nums">{overallPct.toFixed(1)}%</span>
                                <span className={`px-1.5 py-0 rounded text-[9px] font-bold ${overallGrade!.bg} ${overallGrade!.fg}`}>{overallGrade!.letter}</span>
                              </div>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>

                  {/* Footer: class averages */}
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td className="sticky left-0 bg-slate-50 px-4 py-2.5 font-bold text-slate-600 text-[11px] uppercase tracking-wide border-r border-slate-200 z-10">
                        Class Avg
                      </td>
                      {columnStats.map((stat, i) => {
                        const s = subjects[i]
                        if (stat.avgPct == null) {
                          return <td key={s.classroomId} className="px-3 py-2.5 text-center text-slate-400">—</td>
                        }
                        const g = gradeLetter(stat.avgPct)
                        return (
                          <td key={s.classroomId} className="px-3 py-2.5 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="font-bold text-slate-700 tabular-nums">
                                {stat.sumObtained.toFixed(0)}/{stat.sumMax.toFixed(0)}
                              </span>
                              <span className="text-slate-600 font-semibold tabular-nums">{stat.avgPct.toFixed(1)}%</span>
                              <span className={`px-1.5 py-0 rounded text-[9px] font-bold ${g.bg} ${g.fg}`}>{g.letter}</span>
                            </div>
                          </td>
                        )
                      })}
                      <td className="px-3 py-2.5 text-center border-l border-slate-200">
                        {overallStat.pct != null ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-bold text-slate-700 tabular-nums">{overallStat.sumObtained}/{overallStat.sumMax}</span>
                            <span className="font-bold text-slate-700 tabular-nums">{overallStat.pct.toFixed(1)}%</span>
                            <span className={`px-1.5 py-0 rounded text-[9px] font-bold ${gradeLetter(overallStat.pct).bg} ${gradeLetter(overallStat.pct).fg}`}>
                              {gradeLetter(overallStat.pct).letter}
                            </span>
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
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
  const [availableYears, setAvailableYears] = useState<string[]>([])
  const [selectedYear, setSelectedYear] = useState<string | null>(null)
  const yearsLoadedRef = useRef(false)

  const load = useCallback(async (year: string | null) => {
    setLoading(true)
    const [g, r] = await Promise.all([
      selfView
        ? fetchReportCardsForStudent(studentProfile.id, year)
        : fetchReportCardsForStudentAsViewer(studentProfile.id, viewerId, viewerRole),
      fetchRemarksForStudent(studentProfile.id),
    ])
    setGroups(g)
    setRemarks(r)
    setLoading(false)
  }, [studentProfile.id, viewerId, viewerRole, selfView])

  // Fetch available years once, then auto-select the most recent.
  useEffect(() => {
    if (!selfView || yearsLoadedRef.current) return
    yearsLoadedRef.current = true
    fetchAvailableAcademicYearsForStudent(studentProfile.id).then(years => {
      setAvailableYears(years)
      if (years.length > 0) {
        setSelectedYear(years[0])
      }
    })
  }, [studentProfile.id, selfView])

  useEffect(() => {
    // For staff view (no year toggle), fire immediately.
    // For student view, wait until year state is ready (either set or confirmed empty).
    if (selfView && !yearsLoadedRef.current) return
    load(selfView ? selectedYear : null)
  }, [load, selfView, selectedYear])

  // Sort report card groups so the most-recently-assessed title appears first.
  const sortedEntries = useMemo(() => {
    if (!groups) return []
    return Array.from(groups.entries()).sort(([, aList], [, bList]) => {
      const latestDate = (list: StudentReportCardEntry[]) =>
        Math.max(0, ...list.map(e => e.assessment.date ? new Date(e.assessment.date).getTime() : 0))
      return latestDate(bList) - latestDate(aList)
    })
  }, [groups])

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-500">Loading report cards…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Academic year toggle — only shown for student self-view with multiple years */}
      {selfView && availableYears.length > 1 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <CalendarRange size={13} className="text-rose-400" /> Academic Year
          </span>
          <div className="inline-flex flex-wrap gap-1 p-1 bg-slate-100/80 rounded-full">
            {availableYears.map(year => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                className={`px-3.5 py-1 rounded-full text-xs font-bold transition-all ${
                  selectedYear === year
                    ? 'bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
      )}

      {(!groups || groups.size === 0) ? (
        <div className="text-center py-10">
          <FileText size={32} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No report cards yet</p>
          <p className="text-xs text-slate-400 mt-1">
            Assessments tagged with a report card title will appear here.
          </p>
        </div>
      ) : (
        sortedEntries.map(([title, entries]) => (
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
            onRemarksChanged={() => load(selfView ? selectedYear : null)}
          />
        ))
      )}
    </div>
  )
}

// ─── Single report card ───────────────────────────────────────────────────────

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

  const dates = entries.map(e => e.assessment.date).filter((d): d is string => !!d).sort()
  const periodStart = dates[0]
  const periodEnd = dates[dates.length - 1]

  const congratsMsg = useMemo(
    () => pickCongrats(studentProfile.id + title),
    [studentProfile.id, title]
  )
  const showCongrats = totalMax > 0 && overallPct >= 81

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm print:shadow-none">

      {/* ── Header ── */}
      <div className="relative bg-gradient-to-br from-slate-600 to-slate-700 px-6 py-5 text-white">
        {/* Subtle dot texture */}
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id={`rc-${title.replace(/[^a-z0-9]/gi, '')}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.2" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#rc-${title.replace(/[^a-z0-9]/gi, '')})`} />
          </svg>
        </div>
        {/* Faint corner glow */}
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-white/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative flex items-start gap-4">
          <div className="p-2.5 bg-white/10 rounded-2xl border border-white/15 flex-shrink-0">
            <GraduationCap size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-semibold">
              {branding.tagline || 'Report Card'}
            </p>
            <h3 className="text-lg sm:text-xl font-bold tracking-tight leading-tight mt-0.5">
              {branding.schoolName || 'Report Card'}
            </h3>
            <p className="text-sm text-white/70 mt-1.5 font-medium flex items-center gap-1.5">
              <Bookmark size={12} className="opacity-70" /> {title}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg border border-white/15 text-white/80 hover:text-white text-xs font-medium transition-colors print:hidden"
            title="Print this report card"
          >
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      {/* ── Student info strip ── */}
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
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

      {/* ── Subjects table ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b-2 border-slate-200">
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[11px]">Subject</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[11px]">Assessments</th>
              <th className="text-center px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[11px] whitespace-nowrap">Marks</th>
              <th className="text-center px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[11px] whitespace-nowrap">Out of</th>
              <th className="text-center px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[11px]">%</th>
              <th className="text-center px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wide text-[11px]">Grade</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((row, rowIdx) => {
              const pct = row.max > 0 ? (row.obtained / row.max) * 100 : null
              const grade = pct != null ? gradeLetter(pct) : null
              return (
                <tr key={row.classroomId} className={`border-b border-slate-100 transition-colors ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-50`}>
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
                            <span className="w-1 h-1 rounded-full bg-slate-300 flex-shrink-0" />
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
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="px-4 py-3 font-bold text-slate-700 text-sm uppercase tracking-wide" colSpan={2}>Total</td>
              <td className="px-4 py-3 text-center font-bold text-slate-800 tabular-nums">
                {totalMax > 0 ? totalObtained : '—'}
              </td>
              <td className="px-4 py-3 text-center font-bold text-slate-800 tabular-nums">
                {totalMax > 0 ? totalMax : '—'}
              </td>
              <td className="px-4 py-3 text-center font-bold text-slate-700 tabular-nums">
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

      {/* ── Result summary strip ── */}
      {totalMax > 0 && (
        <div className="px-6 py-3 bg-white border-t border-slate-100 flex items-center gap-4 flex-wrap">
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

      {/* ── Congratulations card (A1 / A2 only) ── */}
      <AnimatePresence>
        {showCongrats && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="mx-5 mb-5"
          >
            <div className="relative rounded-2xl bg-slate-50 border border-slate-200 overflow-hidden shadow-sm">
              {/* Decorative star cluster — top-right */}
              <svg
                className="absolute top-0 right-0 w-28 h-28 opacity-[0.06] pointer-events-none"
                viewBox="0 0 112 112"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M84 14l2.4 7.4H94l-6.3 4.6 2.4 7.4L84 29l-6.1 4.4 2.4-7.4L74 21.4h7.6z" className="text-slate-900" />
                <path d="M56 4l3.6 11H71l-9.4 6.8 3.6 11L56 26.8 46.8 32.8l3.6-11L41 15h11.4z" className="text-slate-900" />
                <path d="M28 18l2.4 7.4H38l-6.3 4.6 2.4 7.4L28 33l-6.1 4.4 2.4-7.4L18 25.4h7.6z" className="text-slate-900" />
                <path d="M70 50l1.8 5.5h5.8l-4.7 3.4 1.8 5.5L70 60.9l-4.7 3.5 1.8-5.5-4.7-3.4h5.8z" className="text-slate-900" />
                <path d="M42 50l1.8 5.5h5.8l-4.7 3.4 1.8 5.5L42 60.9l-4.7 3.5 1.8-5.5-4.7-3.4h5.8z" className="text-slate-900" />
              </svg>

              <div className="relative flex items-center gap-4 px-5 py-4">
                {/* Icon */}
                <div className="w-11 h-11 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center flex-shrink-0">
                  <Award size={20} className="text-slate-700" />
                </div>

                {/* Message */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-sm leading-tight">
                    {congratsMsg.headline}
                  </p>
                  <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">
                    {congratsMsg.sub}
                  </p>
                </div>

                {/* Grade callout */}
                <div className="flex-shrink-0 text-right">
                  <p className="font-black text-slate-900 text-2xl tabular-nums leading-none">
                    {overallPct.toFixed(0)}%
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mt-0.5">
                    {overallGrade.letter} Grade
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Remarks ── */}
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
    <div className="px-5 py-4 bg-slate-50 border-t border-slate-200">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={13} className="text-slate-500" />
        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-600">Remarks</h4>
        <span className="text-[10px] text-slate-400">
          {remarks.length} {remarks.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>

      {others.length > 0 && (
        <div className="space-y-2 mb-3">
          {others.map(r => (
            <RemarkBubble key={r.id} remark={r} />
          ))}
        </div>
      )}

      {canEdit ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {!editing && myRemark ? (
            <div>
              <RemarkBubble remark={myRemark} self />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-slate-600 hover:text-slate-900 font-medium transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="text-xs text-slate-400 hover:text-rose-500 font-medium flex items-center gap-1 disabled:opacity-60 transition-colors"
                >
                  <Trash2 size={11} /> Delete
                </button>
                {savedFlash && (
                  <span className="text-xs text-slate-500 font-medium">Saved ✓</span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Avatar avatarUrl={viewer?.avatar_url} name={viewer?.full_name ?? 'You'} size={26} userId={viewerId} />
                <p className="text-xs font-semibold text-slate-700">{viewer?.full_name ?? 'Your remark'}</p>
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full uppercase tracking-wide font-bold">
                  {viewer?.role ?? 'Staff'}
                </span>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Add a remark for ${reportCardTitle}…`}
                rows={3}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
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
    <div className={`flex items-start gap-2.5 p-2.5 rounded-xl ${self ? 'bg-slate-100/70' : 'bg-white border border-slate-100'}`}>
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
