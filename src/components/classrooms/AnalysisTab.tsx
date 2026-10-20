'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, Star, ClipboardList, BarChart3 } from 'lucide-react'
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
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap px-3 sm:px-0">
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

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      {/* ── Monthly EduPoints trend ── */}
      <div className="min-w-0 bg-white border-y border-slate-200 sm:border sm:rounded-2xl overflow-hidden sm:shadow-sm">
        <div className="flex items-center gap-2 flex-wrap px-3 sm:px-4 py-2.5 border-b border-slate-100">
          <Star size={15} className="text-amber-500" />
          <h3 className="text-sm font-bold text-slate-800">EduPoints by month</h3>
          {mostImproved && (
            <span className="ml-auto min-w-0 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium flex items-center gap-1">
              <TrendingUp size={11} /> Most improved: {mostImproved.name} (+{mostImproved.delta})
            </span>
          )}
        </div>

        {months.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-10 px-4">
            No EduPoints earned yet. They appear when students finish work that carries points.
          </p>
        ) : (
          <div className="p-3 sm:p-4 space-y-4">
            <LineChart labels={months.map(monthLabel)} series={monthlySeries} unit=" EP" />

            {/* Per-student current month + delta */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
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
        )}
      </div>

      {/* ── Exam progress ── */}
      <div className="min-w-0 bg-white border-y border-slate-200 sm:border sm:rounded-2xl overflow-hidden sm:shadow-sm">
        <div className="flex items-center gap-2 flex-wrap px-3 sm:px-4 py-2.5 border-b border-slate-100">
          <ClipboardList size={15} className="text-amber-600" />
          <h3 className="text-sm font-bold text-slate-800">Assessment scores (%)</h3>
          {!selectedStudent && (
            <span className="ml-auto text-[11px] text-slate-500">Pick a student to compare with the class</span>
          )}
        </div>

        {assessments.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-10">No assessments in this classroom yet.</p>
        ) : (
          <div className="p-3 sm:p-4">
            <LineChart labels={examLabels} series={examSeries} yMax={100} unit="%" />
          </div>
        )}
      </div>

      </div>
    </div>
  )
}
