'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown, BarChart3, Loader2, Users, FileSpreadsheet, Download,
} from 'lucide-react'
import {
  SubjectColumn,
  GradeSectionStudentRow,
  fetchGradeSectionList,
  fetchReportCardTitlesForGradeSection,
  fetchGradeSectionClassWiseMarks,
} from '@/lib/classrooms'
import Avatar from '@/components/Avatar'

export default function ClassWiseMarksSection() {
  const [expanded, setExpanded] = useState(false)

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center px-4 py-3 hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex-1 flex items-center gap-2 text-left">
          <div className="p-1.5 bg-teal-100 rounded-lg">
            <BarChart3 size={14} className="text-teal-600" />
          </div>
          <h2 className="font-semibold text-slate-700 text-sm">Class-wise Marks</h2>
          <span className="text-xs text-slate-400 font-normal">
            · All students by grade &amp; section, columns by subject
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
              <ClassWiseMarksView />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ─── Main inner view ──────────────────────────────────────────────────────────

function ClassWiseMarksView() {
  const [gradeSections, setGradeSections] = useState<{ grade: number; section: string }[]>([])
  const [gradeSectionsLoading, setGradeSectionsLoading] = useState(true)

  const [selectedGrade, setSelectedGrade] = useState('')
  const [selectedSection, setSelectedSection] = useState('')

  const [availableTitles, setAvailableTitles] = useState<string[]>([])
  const [titlesLoading, setTitlesLoading] = useState(false)
  const [selectedTitle, setSelectedTitle] = useState('')

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{
    subjects: SubjectColumn[]
    rows: GradeSectionStudentRow[]
  } | null>(null)

  // Load grade+section pairs on mount
  useEffect(() => {
    fetchGradeSectionList().then(list => {
      setGradeSections(list)
      setGradeSectionsLoading(false)
    })
  }, [])

  // Distinct grades and sections derived from the full list
  const grades = useMemo(
    () => Array.from<number>(new Set(gradeSections.map(gs => gs.grade))).sort((a, b) => a - b),
    [gradeSections]
  )
  const sectionsForGrade = useMemo(
    () =>
      selectedGrade
        ? gradeSections
            .filter(gs => gs.grade === Number(selectedGrade))
            .map(gs => gs.section)
            .sort()
        : [],
    [gradeSections, selectedGrade]
  )

  // When grade changes, reset section, title, data
  useEffect(() => {
    setSelectedSection('')
    setSelectedTitle('')
    setAvailableTitles([])
    setData(null)
  }, [selectedGrade])

  // When section changes, load available titles
  useEffect(() => {
    if (!selectedGrade || !selectedSection) {
      setAvailableTitles([])
      setSelectedTitle('')
      setData(null)
      return
    }
    setTitlesLoading(true)
    setSelectedTitle('')
    setData(null)
    fetchReportCardTitlesForGradeSection(Number(selectedGrade), selectedSection).then(titles => {
      setAvailableTitles(titles)
      setTitlesLoading(false)
    })
  }, [selectedGrade, selectedSection])

  // When title changes, fetch marks
  useEffect(() => {
    if (!selectedGrade || !selectedSection || !selectedTitle) { setData(null); return }
    setLoading(true)
    fetchGradeSectionClassWiseMarks(Number(selectedGrade), selectedSection, selectedTitle).then(result => {
      setData(result)
      setLoading(false)
    })
  }, [selectedGrade, selectedSection, selectedTitle])

  const handleCsvDownload = () => {
    if (!data) return
    const { subjects, rows } = data

    const headers = [
      'Student', 'Email',
      ...subjects.map(s => `${s.subject} (Obtained)`),
      ...subjects.map(s => `${s.subject} (Max)`),
      ...subjects.map(s => `${s.subject} (%)`),
      'Overall Obtained', 'Overall Max', 'Overall %', 'Grade',
    ]

    const csvRows = rows.map(row => {
      let totalObtained = 0, totalMax = 0
      const subjectCells = subjects.map(s => {
        const t = row.subjectTotals[s.classroomId]
        if (t) { totalObtained += t.obtained; totalMax += t.max }
        return t ? String(t.obtained) : '—'
      })
      const subjectMaxCells = subjects.map(s => {
        const t = row.subjectTotals[s.classroomId]
        return t ? String(t.max) : '—'
      })
      const subjectPctCells = subjects.map(s => {
        const t = row.subjectTotals[s.classroomId]
        return t && t.max > 0 ? `${((t.obtained / t.max) * 100).toFixed(1)}%` : '—'
      })
      const overallPct = totalMax > 0 ? (totalObtained / totalMax) * 100 : null
      return [
        row.student.full_name,
        row.student.email,
        ...subjectCells,
        ...subjectMaxCells,
        ...subjectPctCells,
        totalMax > 0 ? String(totalObtained) : '—',
        totalMax > 0 ? String(totalMax) : '—',
        overallPct != null ? `${overallPct.toFixed(1)}%` : '—',
        overallPct != null ? gradeLetter(overallPct).letter : '—',
      ]
    })

    const csv = [headers, ...csvRows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Grade ${selectedGrade}-${selectedSection} - ${selectedTitle}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (gradeSectionsLoading) {
    return (
      <div className="text-center py-10">
        <Loader2 size={22} className="text-teal-500 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-500">Loading classes…</p>
      </div>
    )
  }

  if (gradeSections.length === 0) {
    return (
      <div className="text-center py-10">
        <FileSpreadsheet size={28} className="text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm">No classes with subjects configured yet</p>
        <p className="text-xs text-slate-400 mt-1">
          Assign a subject to classrooms in Classroom Management to use this view.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selectors */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Grade */}
        <div className="min-w-[120px]">
          <label className="block text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1.5">
            Grade
          </label>
          <select
            value={selectedGrade}
            onChange={e => setSelectedGrade(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/50"
          >
            <option value="">Select…</option>
            {grades.map(g => (
              <option key={g} value={String(g)}>Grade {g}</option>
            ))}
          </select>
        </div>

        {/* Section */}
        <div className="min-w-[100px]">
          <label className="block text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1.5">
            Section
          </label>
          <select
            value={selectedSection}
            onChange={e => setSelectedSection(e.target.value)}
            disabled={!selectedGrade || sectionsForGrade.length === 0}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">{!selectedGrade ? '—' : 'Section…'}</option>
            {sectionsForGrade.map(s => (
              <option key={s} value={s}>Section {s}</option>
            ))}
          </select>
        </div>

        {/* Report Card */}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1.5">
            Report Card
          </label>
          <select
            value={selectedTitle}
            onChange={e => setSelectedTitle(e.target.value)}
            disabled={!selectedSection || titlesLoading || availableTitles.length === 0}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {titlesLoading
                ? 'Loading…'
                : !selectedSection
                  ? 'Select grade & section first'
                  : availableTitles.length === 0
                    ? 'No report cards yet'
                    : 'Select report card…'}
            </option>
            {availableTitles.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {data && data.rows.length > 0 && (
          <button
            onClick={handleCsvDownload}
            className="flex items-center gap-1.5 px-3 py-2 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-xl text-xs font-semibold text-teal-700 transition-colors"
          >
            <Download size={13} /> Download CSV
          </button>
        )}
      </div>

      {/* States */}
      {loading && (
        <div className="text-center py-10">
          <Loader2 size={24} className="text-teal-500 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">Loading marks…</p>
        </div>
      )}

      {!loading && !selectedGrade && (
        <div className="text-center py-8">
          <FileSpreadsheet size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">Select a grade, section and report card to view</p>
        </div>
      )}

      {!loading && selectedSection && !titlesLoading && availableTitles.length === 0 && (
        <div className="text-center py-8">
          <FileSpreadsheet size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No report card titles found for this class</p>
          <p className="text-xs text-slate-400 mt-1">Tag assessments with a report card title to populate this view.</p>
        </div>
      )}

      {!loading && data && data.subjects.length === 0 && (
        <div className="text-center py-8">
          <Users size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No subjects configured for Grade {selectedGrade}-{selectedSection}</p>
          <p className="text-xs text-slate-400 mt-1">Assign subjects to classrooms for this grade and section.</p>
        </div>
      )}

      {!loading && data && data.rows.length === 0 && data.subjects.length > 0 && (
        <div className="text-center py-8">
          <Users size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No students found in Grade {selectedGrade}-{selectedSection}</p>
        </div>
      )}

      {!loading && data && data.rows.length > 0 && data.subjects.length > 0 && (
        <MarksTable
          subjects={data.subjects}
          rows={data.rows}
          grade={Number(selectedGrade)}
          section={selectedSection}
          reportCardTitle={selectedTitle}
        />
      )}
    </div>
  )
}

// ─── Marks table ──────────────────────────────────────────────────────────────

function MarksTable({
  subjects, rows, grade, section, reportCardTitle,
}: {
  subjects: SubjectColumn[]
  rows: GradeSectionStudentRow[]
  grade: number
  section: string
  reportCardTitle: string
}) {
  const classAvg = useMemo(() => {
    // Per-subject averages
    const subjectAvgs = subjects.map(sub => {
      const marked = rows.filter(r => r.subjectTotals[sub.classroomId] != null)
      if (marked.length === 0) return null
      const totalObtained = marked.reduce((s, r) => s + r.subjectTotals[sub.classroomId]!.obtained, 0)
      const totalMax = marked.reduce((s, r) => s + r.subjectTotals[sub.classroomId]!.max, 0)
      return totalMax > 0 ? (totalObtained / totalMax) * 100 : null
    })

    // Overall average across all subjects
    const withData = rows.filter(r => {
      return subjects.some(sub => r.subjectTotals[sub.classroomId] != null)
    })
    const totalObtained = withData.reduce((s, r) => {
      return s + subjects.reduce((ss, sub) => ss + (r.subjectTotals[sub.classroomId]?.obtained ?? 0), 0)
    }, 0)
    const totalMax = withData.reduce((s, r) => {
      return s + subjects.reduce((ss, sub) => ss + (r.subjectTotals[sub.classroomId]?.max ?? 0), 0)
    }, 0)
    const overallPct = totalMax > 0 ? (totalObtained / totalMax) * 100 : null

    return { subjectAvgs, overallPct, markedCount: withData.length }
  }, [subjects, rows])

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header strip */}
      <div className="px-4 py-3 bg-gradient-to-r from-teal-600 to-emerald-700 flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/70 font-semibold">
            Grade {grade} — Section {section}
          </p>
          <h3 className="text-sm font-bold text-white">{reportCardTitle}</h3>
        </div>
        <div className="ml-auto flex items-center gap-4 text-white/80 text-xs flex-wrap">
          <span className="flex items-center gap-1"><Users size={12} /> {rows.length} student{rows.length === 1 ? '' : 's'}</span>
          <span>{subjects.length} subject{subjects.length === 1 ? '' : 's'}</span>
          {classAvg.overallPct != null && (
            <span className="font-semibold">Class avg: {classAvg.overallPct.toFixed(1)}%</span>
          )}
        </div>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600 text-[11px] uppercase tracking-wide min-w-[180px] sticky left-0 bg-slate-50 z-10">
                Student
              </th>
              {subjects.map(sub => (
                <th
                  key={sub.classroomId}
                  className="text-center px-3 py-3 font-semibold text-slate-600 text-[11px] uppercase tracking-wide min-w-[110px]"
                  title={sub.classroomTitle}
                >
                  {sub.subject}
                </th>
              ))}
              <th className="text-center px-3 py-3 font-semibold text-slate-600 text-[11px] uppercase tracking-wide min-w-[80px] bg-slate-100/80 sticky right-[120px]">
                Total
              </th>
              <th className="text-center px-3 py-3 font-semibold text-slate-600 text-[11px] uppercase tracking-wide min-w-[60px] bg-slate-100/80 sticky right-[60px]">
                %
              </th>
              <th className="text-center px-3 py-3 font-semibold text-slate-600 text-[11px] uppercase tracking-wide min-w-[60px] bg-slate-100/80 sticky right-0">
                Grade
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, idx) => {
              let totalObtained = 0, totalMax = 0
              for (const sub of subjects) {
                const t = row.subjectTotals[sub.classroomId]
                if (t) { totalObtained += t.obtained; totalMax += t.max }
              }
              const overallPct = totalMax > 0 ? (totalObtained / totalMax) * 100 : null
              const grade = overallPct != null ? gradeLetter(overallPct) : null

              return (
                <tr
                  key={row.student.id}
                  className={`border-b border-slate-100 hover:bg-teal-50/20 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}
                >
                  {/* Student name (sticky left) */}
                  <td className={`px-4 py-2.5 sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                    <div className="flex items-center gap-2">
                      <Avatar
                        avatarUrl={row.student.avatar_url}
                        name={row.student.full_name}
                        size={26}
                        userId={row.student.id}
                      />
                      <p className="text-sm font-medium text-slate-800 truncate max-w-[130px]">
                        {row.student.full_name}
                      </p>
                    </div>
                  </td>

                  {/* Per-subject cells */}
                  {subjects.map(sub => {
                    const t = row.subjectTotals[sub.classroomId]
                    const pct = t && t.max > 0 ? Math.round((t.obtained / t.max) * 100) : null
                    const gl = pct != null ? gradeLetter(pct) : null
                    return (
                      <td key={sub.classroomId} className="px-3 py-2.5 text-center tabular-nums">
                        {t ? (
                          <div>
                            <div className="font-semibold text-slate-800">
                              {t.obtained}
                              <span className="text-slate-400 font-normal text-xs">/{t.max}</span>
                            </div>
                            {pct != null && gl && (
                              <div className="flex items-center justify-center gap-1 mt-0.5">
                                <span className="text-[10px] text-slate-400">{pct}%</span>
                                <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${gl.bg} ${gl.fg}`}>
                                  {gl.letter}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                    )
                  })}

                  {/* Total */}
                  <td className="px-3 py-2.5 text-center font-semibold tabular-nums bg-slate-50/60">
                    {totalMax > 0
                      ? <span className="text-slate-800">{totalObtained}<span className="text-slate-400 font-normal text-xs">/{totalMax}</span></span>
                      : <span className="text-slate-300">—</span>}
                  </td>

                  {/* Percentage */}
                  <td className="px-3 py-2.5 text-center font-semibold tabular-nums bg-slate-50/60">
                    {overallPct != null ? (
                      <span className={overallPct >= 60 ? 'text-teal-700' : overallPct >= 33 ? 'text-amber-600' : 'text-red-600'}>
                        {overallPct.toFixed(1)}%
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>

                  {/* Grade */}
                  <td className="px-3 py-2.5 text-center bg-slate-50/60">
                    {grade ? (
                      <span className={`inline-block min-w-[34px] px-2 py-0.5 rounded-md text-xs font-bold ${grade.bg} ${grade.fg}`}>
                        {grade.letter}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>

          {/* Class average footer */}
          <tfoot>
            <tr className="bg-gradient-to-r from-teal-50 to-emerald-50 border-t-2 border-teal-200">
              <td className="px-4 py-3 font-bold text-slate-700 text-xs sticky left-0 bg-teal-50 z-10">
                Class Average
                <div className="text-[10px] font-normal text-slate-400 mt-0.5">
                  {classAvg.markedCount} of {rows.length} marked
                </div>
              </td>
              {classAvg.subjectAvgs.map((avg, i) => (
                <td key={subjects[i].classroomId} className="px-3 py-3 text-center tabular-nums">
                  {avg != null ? (
                    <div>
                      <span className="font-semibold text-teal-700">{avg.toFixed(1)}%</span>
                      <div className={`text-[9px] px-1 py-0.5 rounded font-bold inline-block ml-1 ${gradeLetter(avg).bg} ${gradeLetter(avg).fg}`}>
                        {gradeLetter(avg).letter}
                      </div>
                    </div>
                  ) : <span className="text-slate-300">—</span>}
                </td>
              ))}
              <td className="px-3 py-3 text-center text-slate-400 bg-teal-50/60">—</td>
              <td className="px-3 py-3 text-center font-bold text-teal-700 tabular-nums bg-teal-50/60">
                {classAvg.overallPct != null ? `${classAvg.overallPct.toFixed(1)}%` : '—'}
              </td>
              <td className="px-3 py-3 text-center bg-teal-50/60">
                {classAvg.overallPct != null ? (
                  <span className={`inline-block min-w-[34px] px-2 py-0.5 rounded-md text-xs font-bold ${gradeLetter(classAvg.overallPct).bg} ${gradeLetter(classAvg.overallPct).fg}`}>
                    {gradeLetter(classAvg.overallPct).letter}
                  </span>
                ) : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─── Grade helper ─────────────────────────────────────────────────────────────

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
