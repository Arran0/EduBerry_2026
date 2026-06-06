'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, BarChart3, Loader2, Users, FileSpreadsheet, Download } from 'lucide-react'
import {
  ClassroomWithDetails,
  ClassroomAssessment,
  ClassWiseStudentMarkRow,
  fetchClassWiseMarks,
  fetchReportCardTitlesForClassroom,
} from '@/lib/classrooms'
import Avatar from '@/components/Avatar'

interface ClassWiseMarksSectionProps {
  classrooms: ClassroomWithDetails[]
}

export default function ClassWiseMarksSection({ classrooms }: ClassWiseMarksSectionProps) {
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
            · View all students&apos; marks for a class
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
              <ClassWiseMarksView classrooms={classrooms} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function ClassWiseMarksView({ classrooms }: { classrooms: ClassroomWithDetails[] }) {
  const [selectedClassroomId, setSelectedClassroomId] = useState('')
  const [availableTitles, setAvailableTitles] = useState<string[]>([])
  const [titlesLoading, setTitlesLoading] = useState(false)
  const [selectedTitle, setSelectedTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{
    assessments: ClassroomAssessment[]
    rows: ClassWiseStudentMarkRow[]
    maxMarksByAssessment: Record<string, number>
  } | null>(null)

  useEffect(() => {
    if (!selectedClassroomId) {
      setAvailableTitles([])
      setSelectedTitle('')
      setData(null)
      return
    }
    setTitlesLoading(true)
    setSelectedTitle('')
    setData(null)
    fetchReportCardTitlesForClassroom(selectedClassroomId).then(titles => {
      setAvailableTitles(titles)
      setTitlesLoading(false)
    })
  }, [selectedClassroomId])

  useEffect(() => {
    if (!selectedClassroomId || !selectedTitle) { setData(null); return }
    setLoading(true)
    fetchClassWiseMarks(selectedClassroomId, selectedTitle).then(result => {
      setData(result)
      setLoading(false)
    })
  }, [selectedClassroomId, selectedTitle])

  const selectedClassroom = classrooms.find(c => c.id === selectedClassroomId)

  const handleCsvDownload = () => {
    if (!data || !selectedClassroom) return
    const { assessments, rows, maxMarksByAssessment } = data

    const headers = [
      'Student',
      'Email',
      ...assessments.map(a => `${a.title} (/${maxMarksByAssessment[a.id] ?? 100})`),
      'Total Obtained',
      'Total Max',
      'Percentage',
      'Grade',
    ]

    const csvRows = rows.map(row => {
      const pct = row.max > 0 ? (row.obtained / row.max) * 100 : null
      const grade = pct != null ? gradeLetter(pct).letter : '—'
      const markCells = assessments.map(a => {
        const mark = row.marksByAssessment[a.id]
        return mark && mark.marks != null ? String(mark.marks) : '—'
      })
      return [
        row.student.full_name,
        row.student.email,
        ...markCells,
        row.max > 0 ? String(row.obtained) : '—',
        row.max > 0 ? String(row.max) : '—',
        pct != null ? `${pct.toFixed(1)}%` : '—',
        grade,
      ]
    })

    const csvContent = [headers, ...csvRows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedClassroom.title} - ${selectedTitle}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (classrooms.length === 0) {
    return (
      <div className="text-center py-10">
        <Users size={28} className="text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm">No classrooms found</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selectors row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1.5">
            Classroom
          </label>
          <select
            value={selectedClassroomId}
            onChange={e => setSelectedClassroomId(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/50"
          >
            <option value="">Select a classroom…</option>
            {classrooms.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1.5">
            Report Card
          </label>
          <select
            value={selectedTitle}
            onChange={e => setSelectedTitle(e.target.value)}
            disabled={!selectedClassroomId || titlesLoading || availableTitles.length === 0}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {titlesLoading
                ? 'Loading…'
                : !selectedClassroomId
                  ? 'Select a classroom first'
                  : availableTitles.length === 0
                    ? 'No report cards yet'
                    : 'Select a report card…'}
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

      {!loading && !selectedClassroomId && (
        <div className="text-center py-10">
          <FileSpreadsheet size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">Select a classroom and report card to view marks</p>
        </div>
      )}

      {!loading && selectedClassroomId && !titlesLoading && availableTitles.length === 0 && (
        <div className="text-center py-10">
          <FileSpreadsheet size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No report card titles in this classroom yet</p>
          <p className="text-xs text-slate-400 mt-1">
            Tag assessments with a report card title to see them here.
          </p>
        </div>
      )}

      {!loading && data && data.rows.length === 0 && (
        <div className="text-center py-10">
          <Users size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No students found in this classroom</p>
        </div>
      )}

      {!loading && data && data.rows.length > 0 && (
        <ClassWiseMarksTable
          assessments={data.assessments}
          rows={data.rows}
          maxMarksByAssessment={data.maxMarksByAssessment}
          classroomTitle={selectedClassroom?.title ?? ''}
          reportCardTitle={selectedTitle}
        />
      )}
    </div>
  )
}

function ClassWiseMarksTable({
  assessments,
  rows,
  maxMarksByAssessment,
  classroomTitle,
  reportCardTitle,
}: {
  assessments: ClassroomAssessment[]
  rows: ClassWiseStudentMarkRow[]
  maxMarksByAssessment: Record<string, number>
  classroomTitle: string
  reportCardTitle: string
}) {
  const classStats = useMemo(() => {
    const avgByAssessment = assessments.map(a => {
      const marked = rows.filter(r => r.marksByAssessment[a.id]?.marks != null)
      if (marked.length === 0) return null
      const sum = marked.reduce((s, r) => s + Number(r.marksByAssessment[a.id]!.marks), 0)
      return sum / marked.length
    })

    const markedRows = rows.filter(r => r.max > 0)
    const totalObtained = markedRows.reduce((s, r) => s + r.obtained, 0)
    const totalMax = markedRows.reduce((s, r) => s + r.max, 0)
    const avgPct = totalMax > 0 ? (totalObtained / totalMax) * 100 : null

    return { avgByAssessment, avgPct, markedCount: markedRows.length }
  }, [assessments, rows])

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header strip */}
      <div className="px-4 py-3 bg-gradient-to-r from-teal-600 to-emerald-700 flex items-center gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/70 font-semibold">{classroomTitle}</p>
          <h3 className="text-sm font-bold text-white">{reportCardTitle}</h3>
        </div>
        <div className="ml-auto flex items-center gap-4 text-white/80 text-xs">
          <span className="flex items-center gap-1"><Users size={12} /> {rows.length} student{rows.length === 1 ? '' : 's'}</span>
          <span>{assessments.length} assessment{assessments.length === 1 ? '' : 's'}</span>
          {classStats.avgPct != null && (
            <span className="font-semibold">Class avg: {classStats.avgPct.toFixed(1)}%</span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600 text-[11px] uppercase tracking-wide min-w-[180px]">
                Student
              </th>
              {assessments.map(a => (
                <th
                  key={a.id}
                  className="text-center px-3 py-2.5 font-semibold text-slate-600 text-[11px] uppercase tracking-wide min-w-[90px]"
                  title={a.title}
                >
                  <div className="truncate max-w-[110px] mx-auto">{a.title}</div>
                  <div className="text-[9px] text-slate-400 font-normal normal-case tracking-normal mt-0.5">
                    /{maxMarksByAssessment[a.id] ?? 100}
                  </div>
                </th>
              ))}
              <th className="text-center px-3 py-2.5 font-semibold text-slate-600 text-[11px] uppercase tracking-wide whitespace-nowrap bg-slate-100/80 min-w-[80px]">Total</th>
              <th className="text-center px-3 py-2.5 font-semibold text-slate-600 text-[11px] uppercase tracking-wide whitespace-nowrap bg-slate-100/80 min-w-[60px]">%</th>
              <th className="text-center px-3 py-2.5 font-semibold text-slate-600 text-[11px] uppercase tracking-wide whitespace-nowrap bg-slate-100/80 min-w-[60px]">Grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const pct = row.max > 0 ? (row.obtained / row.max) * 100 : null
              const grade = pct != null ? gradeLetter(pct) : null
              return (
                <tr
                  key={row.student.id}
                  className={`border-b border-slate-100 hover:bg-teal-50/20 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar
                        avatarUrl={row.student.avatar_url}
                        name={row.student.full_name}
                        size={26}
                        userId={row.student.id}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{row.student.full_name}</p>
                        {(row.student.grade || row.student.section) && (
                          <p className="text-[10px] text-slate-400">
                            {row.student.grade ? `Grade ${row.student.grade}` : ''}
                            {row.student.grade && row.student.section ? ' · ' : ''}
                            {row.student.section ?? ''}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  {assessments.map(a => {
                    const mark = row.marksByAssessment[a.id]
                    const hasMarks = mark && mark.marks != null
                    const aPct = hasMarks
                      ? Math.round((Number(mark.marks) / Number(mark.max_marks)) * 100)
                      : null
                    return (
                      <td key={a.id} className="px-3 py-2.5 text-center tabular-nums">
                        {hasMarks ? (
                          <div>
                            <span className="font-semibold text-slate-800">{mark.marks}</span>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {aPct != null ? `${aPct}%` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-center font-semibold text-slate-800 tabular-nums bg-slate-50/60">
                    {row.max > 0 ? `${row.obtained}/${row.max}` : <span className="text-slate-300 font-normal">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums font-semibold bg-slate-50/60">
                    {pct != null ? (
                      <span className={pct >= 60 ? 'text-teal-700' : pct >= 33 ? 'text-amber-600' : 'text-red-600'}>
                        {pct.toFixed(1)}%
                      </span>
                    ) : <span className="text-slate-300 font-normal">—</span>}
                  </td>
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
          <tfoot>
            <tr className="bg-gradient-to-r from-teal-50 to-emerald-50 border-t-2 border-teal-200">
              <td className="px-4 py-3 font-bold text-slate-700 text-xs">
                Class Average
                <div className="text-[10px] font-normal text-slate-400 mt-0.5">{classStats.markedCount} of {rows.length} marked</div>
              </td>
              {classStats.avgByAssessment.map((avg, i) => (
                <td key={assessments[i].id} className="px-3 py-3 text-center tabular-nums">
                  {avg != null ? (
                    <span className="font-semibold text-teal-700">{avg.toFixed(1)}</span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
              ))}
              <td className="px-3 py-3 text-center font-bold text-slate-500 tabular-nums bg-teal-50/60">—</td>
              <td className="px-3 py-3 text-center font-bold text-teal-700 tabular-nums bg-teal-50/60">
                {classStats.avgPct != null ? `${classStats.avgPct.toFixed(1)}%` : '—'}
              </td>
              <td className="px-3 py-3 text-center bg-teal-50/60">
                {classStats.avgPct != null ? (
                  <span className={`inline-block min-w-[34px] px-2 py-0.5 rounded-md text-xs font-bold ${gradeLetter(classStats.avgPct).bg} ${gradeLetter(classStats.avgPct).fg}`}>
                    {gradeLetter(classStats.avgPct).letter}
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
