'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, Star, ClipboardList, BarChart3, Trophy } from 'lucide-react'
import {
  ClassroomWithDetails, ClassroomAssessment, AssessmentMark,
  fetchAssessments, fetchAssessmentMarks, fetchStudentMembers,
} from '@/lib/classrooms'
import { UserRole, UserProfile, isStaffRole } from '@/lib/supabase'
import { fetchClassroomEduMonthly, EduMonthlyRow } from '@/lib/gamification'
import LineChart, { ChartSeries } from '@/components/charts/LineChart'

interface AnalysisTabProps {
  classroomId: string
  userId: string
  userRole: UserRole
  classroom: ClassroomWithDetails
}

const ACCENT = '#10b981'      // emerald — primary series
const AVG_COLOR = '#94a3b8'   // slate — class average overlay

function monthLabel(m: string): string {
  const d = new Date(m)
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

export default function AnalysisTab({ classroomId, userRole }: AnalysisTabProps) {
  const isStaff = isStaffRole(userRole)

  const [loading, setLoading] = useState(true)
  const [monthly, setMonthly] = useState<EduMonthlyRow[]>([])
  const [students, setStudents] = useState<UserProfile[]>([])
  const [assessments, setAssessments] = useState<ClassroomAssessment[]>([])
  const [marksByAssessment, setMarksByAssessment] = useState<Record<string, Record<string, AssessmentMark>>>({})
  const [selectedStudent, setSelectedStudent] = useState<string>('')

  useEffect(() => {
    if (!isStaff) return
    let active = true
    setLoading(true)
    ;(async () => {
      const [m, members, assessDesc] = await Promise.all([
        fetchClassroomEduMonthly(classroomId),
        fetchStudentMembers(classroomId),
        fetchAssessments(classroomId),
      ])
      const assessAsc = [...assessDesc].reverse() // chronological for charts
      const markArrays = await Promise.all(assessAsc.map(a => fetchAssessmentMarks(a.id)))
      if (!active) return

      const byAssessment: Record<string, Record<string, AssessmentMark>> = {}
      assessAsc.forEach((a, i) => {
        const map: Record<string, AssessmentMark> = {}
        for (const mk of markArrays[i]) map[mk.student_id] = mk
        byAssessment[a.id] = map
      })

      setMonthly(m)
      setStudents(members.map(mem => mem.user))
      setAssessments(assessAsc)
      setMarksByAssessment(byAssessment)
      setLoading(false)
    })().catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [classroomId, isStaff])

  // ── Monthly EduPoints derived structures ──────────────────────────────────
  const months = useMemo(
    () => [...new Set(monthly.map(r => r.month))].sort(),
    [monthly],
  )

  // pointsByStudent[studentId][month] = points
  const pointsByStudent = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    for (const r of monthly) {
      ;(map[r.student_id] ??= {})[r.month] = r.points
    }
    return map
  }, [monthly])

  const studentName = useMemo(() => {
    const map: Record<string, string> = {}
    for (const r of monthly) map[r.student_id] = r.full_name
    for (const s of students) map[s.id] = s.full_name
    return map
  }, [monthly, students])

  // Per-student current-month total and delta vs previous month.
  const monthlyRows = useMemo(() => {
    if (months.length === 0) return []
    const last = months[months.length - 1]
    const prev = months.length > 1 ? months[months.length - 2] : null
    const ids = Object.keys(pointsByStudent)
    return ids.map(id => {
      const cur = pointsByStudent[id][last] ?? 0
      const before = prev ? (pointsByStudent[id][prev] ?? 0) : 0
      return { id, name: studentName[id] || 'Student', current: cur, delta: cur - before }
    }).sort((a, b) => b.current - a.current || b.delta - a.delta)
  }, [months, pointsByStudent, studentName])

  const mostImproved = useMemo(
    () => monthlyRows.filter(r => r.delta > 0).sort((a, b) => b.delta - a.delta)[0] ?? null,
    [monthlyRows],
  )

  // The top earner across every month in this classroom.
  const mostPoints = useMemo(() => {
    let best: { name: string; total: number } | null = null
    for (const [id, byMonth] of Object.entries(pointsByStudent)) {
      const total = Object.values(byMonth).reduce((s, v) => s + v, 0)
      if (total > 0 && (!best || total > best.total)) best = { name: studentName[id] || 'Student', total }
    }
    return best
  }, [pointsByStudent, studentName])

  // Total class EduPoints per month (one line) + optional selected-student line.
  const monthlySeries = useMemo<ChartSeries[]>(() => {
    if (months.length === 0) return []
    const classTotals = months.map(m => monthly.filter(r => r.month === m).reduce((s, r) => s + r.points, 0))
    const series: ChartSeries[] = [{ name: 'Class total', color: ACCENT, values: classTotals }]
    if (selectedStudent && pointsByStudent[selectedStudent]) {
      series.push({
        name: studentName[selectedStudent] || 'Student',
        color: '#6366f1',
        values: months.map(m => pointsByStudent[selectedStudent][m] ?? 0),
      })
    }
    return series
  }, [months, monthly, selectedStudent, pointsByStudent, studentName])

  // ── Exam progress derived structures ──────────────────────────────────────
  const examLabels = useMemo(() => assessments.map(a => a.title), [assessments])

  const pct = (mk?: AssessmentMark): number | null => {
    if (!mk || mk.marks == null || !mk.max_marks) return null
    return Math.round((Number(mk.marks) / Number(mk.max_marks)) * 1000) / 10
  }

  const classAvgByAssessment = useMemo(
    () => assessments.map(a => {
      const marks: AssessmentMark[] = Object.values(marksByAssessment[a.id] || {})
      const vals = marks.map(m => pct(m)).filter((v): v is number => v != null)
      if (vals.length === 0) return null
      return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
    }),
    [assessments, marksByAssessment],
  )

  const examSeries = useMemo<ChartSeries[]>(() => {
    const series: ChartSeries[] = [{ name: 'Class average', color: AVG_COLOR, values: classAvgByAssessment }]
    if (selectedStudent) {
      series.unshift({
        name: studentName[selectedStudent] || 'Student',
        color: ACCENT,
        values: assessments.map(a => pct(marksByAssessment[a.id]?.[selectedStudent])),
      })
    }
    return series
  }, [classAvgByAssessment, selectedStudent, assessments, marksByAssessment, studentName])

  if (!isStaff) {
    return (
      <div className="text-center py-16">
        <BarChart3 size={32} className="text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-600">Analysis is available to staff only.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-600">Loading…</p>
      </div>
    )
  }

  const studentOptions = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name))

  return (
    <div className="space-y-5">
      {/* Student focus selector (shared by both charts) */}
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap ">
        <label htmlFor="analysis-student" className="text-[13px] font-semibold text-slate-600">Show a student</label>
        <select
          id="analysis-student"
          value={selectedStudent}
          onChange={e => setSelectedStudent(e.target.value)}
          className="flex-1 min-w-0 sm:max-w-sm border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 text-slate-800 transition-all"
        >
          <option value="">Whole class</option>
          {studentOptions.map(s => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>
      </div>

      {/* Side by side from lg, the two panels share one height: the right one
          (a chart of fixed size) sets it, and the left one's table scrolls
          inside it rather than stretching the row. */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      {/* ── Monthly EduPoints trend ── */}
      <div className="min-w-0 flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-100">
          <Star size={15} className="text-amber-500" />
          <h3 className="text-sm font-bold text-slate-800">EduPoints by month</h3>
        </div>

        {months.length === 0 ? (
          <p className="flex-1 flex items-center justify-center text-sm text-slate-600 text-center py-10 px-4">
            No EduPoints earned yet. They appear when students finish work that carries points.
          </p>
        ) : (
          <div className="lg:flex-1 lg:relative lg:min-h-[24rem]">
            <div className="lg:absolute lg:inset-0 flex flex-col p-3 sm:p-4 gap-3">
              {/* The two names worth knowing first */}
              {(mostPoints || mostImproved) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-shrink-0">
                  <div className="min-w-0 flex items-center gap-2.5 rounded-xl bg-amber-50/80 border border-amber-100 px-3 py-2">
                    <span className="keep-round w-8 h-8 flex-shrink-0 rounded-full bg-amber-100 text-amber-600 grid place-items-center"><Trophy size={15} /></span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium text-amber-800/80">Most EduPoints</span>
                      <span className="block text-[13px] font-semibold text-slate-800 break-words leading-snug">
                        {mostPoints ? <>{mostPoints.name} <span className="tabular-nums text-amber-700">{mostPoints.total}</span></> : 'None yet'}
                      </span>
                    </span>
                  </div>
                  <div className="min-w-0 flex items-center gap-2.5 rounded-xl bg-emerald-50/80 border border-emerald-100 px-3 py-2">
                    <span className="keep-round w-8 h-8 flex-shrink-0 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center"><TrendingUp size={15} /></span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium text-emerald-800/80">Most improved this month</span>
                      <span className="block text-[13px] font-semibold text-slate-800 break-words leading-snug">
                        {mostImproved ? <>{mostImproved.name} <span className="tabular-nums text-emerald-700">+{mostImproved.delta}</span></> : 'No rise yet'}
                      </span>
                    </span>
                  </div>
                </div>
              )}

              <div className="flex-shrink-0">
                <LineChart labels={months.map(monthLabel)} series={monthlySeries} unit=" EP" height={160} />
              </div>

              {/* Per-student current month + delta; scrolls inside the panel */}
              <div className="lg:flex-1 lg:min-h-0 overflow-auto -mx-1 px-1 lg:[mask-image:linear-gradient(to_bottom,#000_calc(100%-18px),transparent)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-left">
                      <th className="py-2 px-2 text-[12px] font-semibold text-slate-600">Student</th>
                      <th className="py-2 px-2 text-[12px] font-semibold text-slate-600 text-right">This month</th>
                      <th className="py-2 px-2 text-[12px] font-semibold text-slate-600 text-right">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRows.map(r => (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedStudent(prev => prev === r.id ? '' : r.id)}
                        className={`border-b border-slate-50 cursor-pointer transition-colors ${
                          selectedStudent === r.id ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2 px-2 font-medium text-slate-700">{r.name}</td>
                        <td className="py-2 px-2 text-right font-bold text-slate-800 tabular-nums">{r.current}</td>
                        <td className="py-2 px-2 text-right">
                          <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
                            r.delta > 0 ? 'text-emerald-700' : r.delta < 0 ? 'text-rose-600' : 'text-slate-600'
                          }`}>
                            {r.delta > 0 ? <TrendingUp size={13} /> : r.delta < 0 ? <TrendingDown size={13} /> : <Minus size={13} />}
                            {r.delta > 0 ? `+${r.delta}` : r.delta}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Exam progress ── */}
      <div className="min-w-0 flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 flex-wrap px-3 sm:px-4 py-2.5 border-b border-slate-100">
          <ClipboardList size={15} className="text-amber-600" />
          <h3 className="text-sm font-bold text-slate-800">Assessment scores (%)</h3>
          {!selectedStudent && (
            <span className="ml-auto text-[11px] text-slate-500">Pick a student to compare with the class</span>
          )}
        </div>

        {assessments.length === 0 ? (
          <p className="flex-1 flex items-center justify-center text-sm text-slate-600 text-center py-10 px-4">No assessments in this classroom yet.</p>
        ) : (
          <div className="flex-1 flex flex-col justify-center p-3 sm:p-4">
            <LineChart labels={examLabels} series={examSeries} yMax={100} unit="%" height={280} />
          </div>
        )}
      </div>

      </div>
    </div>
  )
}
