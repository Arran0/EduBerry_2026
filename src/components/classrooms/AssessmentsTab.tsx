'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, ClipboardList, Calendar, Save, Edit3, Award, Download, Bookmark, ArrowUpDown, ChevronUp, ChevronDown, UserX, AlertTriangle, Pencil, Check, X, User } from 'lucide-react'
import {
  ClassroomAssessment, AssessmentMark,
  createAssessment, fetchAssessments, deleteAssessment, updateAssessment,
  upsertAssessmentMarks, fetchAssessmentMarks, fetchStudentAssessmentMarks, fetchStudentMembers, fetchProfilesByIds,
  ClassroomMember, ClassroomWithDetails,
} from '@/lib/classrooms'
import { UserRole, UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import ReportCardTitlePicker from '@/components/classrooms/ReportCardTitlePicker'
import ModalShell from '@/components/ui/ModalShell'

interface AssessmentsTabProps {
  classroomId: string
  userId: string
  userRole: UserRole
  classroom: ClassroomWithDetails
}

export default function AssessmentsTab({ classroomId, userId, userRole, classroom }: AssessmentsTabProps) {
  const [assessments, setAssessments] = useState<ClassroomAssessment[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [showMarksheet, setShowMarksheet] = useState<string | null>(null)
  const [marks, setMarks] = useState<Record<string, { marks: string; isAbsent: boolean }>>({})
  const [students, setStudents] = useState<(ClassroomMember & { user: UserProfile })[]>([])
  const [saving, setSaving] = useState(false)
  // Assessment creators, keyed by id — shown on the assessment's card and in
  // the marksheet header so staff can see who set it up.
  const [creators, setCreators] = useState<Record<string, UserProfile>>({})
  const [marksheetSort, setMarksheetSort] = useState<'name' | 'marks'>('name')
  const [marksheetSortDir, setMarksheetSortDir] = useState<'asc' | 'desc'>('asc')

  // Max marks for the currently open marksheet — one value, shared by every
  // student in the assessment (requirement: uniform, not per-student).
  const [assessmentMaxMarks, setAssessmentMaxMarks] = useState<number>(100)
  const [editingMaxMarks, setEditingMaxMarks] = useState(false)
  const [maxMarksDraft, setMaxMarksDraft] = useState('')
  const [savingMaxMarks, setSavingMaxMarks] = useState(false)

  // Edit assessment state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editReportCardTitle, setEditReportCardTitle] = useState<string | null>(null)
  const [editMaxMarks, setEditMaxMarks] = useState('100')
  const [editSaving, setEditSaving] = useState(false)

  // New assessment form
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newReportCardTitle, setNewReportCardTitle] = useState<string | null>(null)
  const [newMaxMarks, setNewMaxMarks] = useState('100')

  const isStudent = userRole === 'student'
  const isStaff = ['teacher', 'coordinator', 'principal', 'admin'].includes(userRole)

  // Refs to every mark <input>, in display order, so Tab/Enter can jump
  // straight to the next student's field for fast, spreadsheet-like entry.
  const markInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const loadAssessments = useCallback(async () => {
    setLoading(true)
    const data = await fetchAssessments(classroomId)
    setAssessments(data)
    setLoading(false)
    fetchProfilesByIds(data.map(a => a.created_by)).then(setCreators)
  }, [classroomId])

  useEffect(() => { loadAssessments() }, [loadAssessments])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    const maxMarks = parseFloat(newMaxMarks)
    if (!isFinite(maxMarks) || maxMarks <= 0) return

    const result = await createAssessment({
      classroom_id: classroomId,
      title: newTitle.trim(),
      description: newDesc.trim() || undefined,
      date: newDate || undefined,
      tag: 'other',
      report_card_title: newReportCardTitle,
      max_marks: maxMarks,
    }, userId)

    if (result) {
      setAssessments((prev) => [result, ...prev])
      setCreators(prev => prev[userId] ? prev : {
        ...prev,
        ...(classroom.members.find(m => m.user_id === userId)?.user
          ? { [userId]: classroom.members.find(m => m.user_id === userId)!.user! }
          : {}),
      })
      setNewTitle('')
      setNewDesc('')
      setNewDate('')
      setNewReportCardTitle(null)
      setNewMaxMarks('100')
      setShowNewForm(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this assessment?')) return
    const success = await deleteAssessment(id)
    if (success) {
      setAssessments((prev) => prev.filter((a) => a.id !== id))
    }
  }

  const handleStartEdit = (a: ClassroomAssessment) => {
    setEditingId(a.id)
    setEditTitle(a.title)
    setEditDesc(a.description || '')
    setEditDate(a.date || '')
    setEditReportCardTitle(a.report_card_title)
    setEditMaxMarks(String(a.max_marks))
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editTitle.trim()) return
    const maxMarks = parseFloat(editMaxMarks)
    if (!isFinite(maxMarks) || maxMarks <= 0) return
    setEditSaving(true)
    const ok = await updateAssessment(editingId, {
      title: editTitle.trim(),
      description: editDesc.trim() || undefined,
      date: editDate || undefined,
      report_card_title: editReportCardTitle,
      max_marks: maxMarks,
    })
    if (ok) {
      setAssessments(prev => prev.map(a => a.id === editingId
        ? {
            ...a,
            title: editTitle.trim(),
            description: editDesc.trim() || null,
            date: editDate || null,
            report_card_title: editReportCardTitle,
            max_marks: maxMarks,
          }
        : a
      ))
      setEditingId(null)
    }
    setEditSaving(false)
  }

  const handleOpenMarksheet = async (assessmentId: string) => {
    setShowMarksheet(assessmentId)
    setEditingMaxMarks(false)
    const assessment = assessments.find(a => a.id === assessmentId)
    setAssessmentMaxMarks(assessment?.max_marks ?? 100)

    const [existingMarks, studentList] = await Promise.all([
      fetchAssessmentMarks(assessmentId),
      fetchStudentMembers(classroomId),
    ])
    setStudents(studentList)

    const marksMap: Record<string, { marks: string; isAbsent: boolean }> = {}
    for (const student of studentList) {
      const existing = existingMarks.find((m) => m.student_id === student.user_id)
      marksMap[student.user_id] = {
        marks: existing?.marks != null ? String(existing.marks) : '',
        isAbsent: existing?.is_absent ?? false,
      }
    }
    setMarks(marksMap)
  }

  const handleDownload = () => {
    const assessment = assessments.find(a => a.id === showMarksheet)
    if (!assessment || students.length === 0) return
    const rows: string[][] = [['Student', 'Marks', 'Out of', 'Percentage']]
    for (const student of students) {
      const mark = marks[student.user_id] || { marks: '', isAbsent: false }
      const num = mark.marks !== '' ? parseFloat(mark.marks) : null
      const pct = !mark.isAbsent && num != null && !isNaN(num) ? `${Math.round((num / assessmentMaxMarks) * 100)}%` : ''
      rows.push([
        student.user.full_name,
        mark.isAbsent ? 'AB' : mark.marks,
        String(assessmentMaxMarks),
        pct,
      ])
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${assessment.title.replace(/[^a-z0-9]/gi, '_')}_marksheet.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // A mark is invalid if it's negative or exceeds the assessment's max —
  // absent students have no numeric mark to validate.
  const getMarkError = useCallback((value: string): string | null => {
    if (value.trim() === '') return null
    const n = parseFloat(value)
    if (isNaN(n)) return 'Invalid number'
    if (n < 0) return 'Cannot be negative'
    if (n > assessmentMaxMarks) return `Cannot exceed ${assessmentMaxMarks}`
    return null
  }, [assessmentMaxMarks])

  const hasInvalidMarks = Object.values(marks).some(
    (m) => !m.isAbsent && getMarkError(m.marks) != null
  )

  const handleSaveMarks = async (assessmentId: string) => {
    if (hasInvalidMarks) return
    setSaving(true)
    await upsertAssessmentMarks(assessmentId, Object.entries(marks).map(([studentId, mark]) => ({
      studentId,
      marks: mark.isAbsent || mark.marks.trim() === '' ? null : parseFloat(mark.marks),
      maxMarks: assessmentMaxMarks,
      isAbsent: mark.isAbsent,
    })))
    setSaving(false)
    setShowMarksheet(null)
  }

  const handleStartEditMaxMarks = () => {
    setMaxMarksDraft(String(assessmentMaxMarks))
    setEditingMaxMarks(true)
  }

  const handleSaveMaxMarks = async () => {
    if (!showMarksheet) return
    const newMax = parseFloat(maxMarksDraft)
    if (!isFinite(newMax) || newMax <= 0) return
    setSavingMaxMarks(true)
    const ok = await updateAssessment(showMarksheet, { max_marks: newMax })
    if (ok) {
      setAssessmentMaxMarks(newMax)
      setAssessments(prev => prev.map(a => a.id === showMarksheet ? { ...a, max_marks: newMax } : a))
      setEditingMaxMarks(false)
    }
    setSavingMaxMarks(false)
  }

  // Student view: fetch own marks
  const [studentMarks, setStudentMarks] = useState<Record<string, AssessmentMark>>({})
  useEffect(() => {
    if (isStudent && assessments.length > 0) {
      const loadMarks = async () => {
        const byAssessment = await fetchStudentAssessmentMarks(userId, assessments.map(a => a.id))
        setStudentMarks(byAssessment)
      }
      loadMarks()
    }
  }, [isStudent, assessments, userId])

  const focusMarkInput = (studentId: string) => {
    const el = markInputRefs.current[studentId]
    if (el) { el.focus(); el.select() }
  }

  // Tab/Enter jump straight to the next student's mark field (in whatever
  // order the sheet is currently sorted) instead of the browser's default
  // tab order, which would otherwise land on the AB toggle button first.
  const handleMarkKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentStudentId: string,
    order: string[],
  ) => {
    if (e.key !== 'Tab' && e.key !== 'Enter') return
    const idx = order.indexOf(currentStudentId)
    if (e.key === 'Enter') {
      e.preventDefault()
      if (idx < order.length - 1) focusMarkInput(order[idx + 1])
      return
    }
    if (e.shiftKey) {
      if (idx > 0) { e.preventDefault(); focusMarkInput(order[idx - 1]) }
    } else if (idx < order.length - 1) {
      e.preventDefault()
      focusMarkInput(order[idx + 1])
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-600">Loading assessments...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-3 sm:px-0">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-100 rounded-xl">
            <ClipboardList size={16} className="text-amber-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800 text-sm">Assessments</h2>
            <p className="text-xs text-slate-500">{assessments.length} total</p>
          </div>
        </div>
        {isStaff && (
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="keep-round flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-full text-xs font-semibold transition-all shadow-lg shadow-amber-500/25 active:scale-95 flex-shrink-0"
          >
            <Plus size={13} /> New Assessment
          </button>
        )}
      </div>

      {/* New Assessment Form */}
      <AnimatePresence>
        {showNewForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCreate}
            className="glass mx-2 sm:mx-0 rounded-2xl p-4 space-y-3 border border-amber-100"
          >
            <div className="flex items-center gap-2 mb-1">
              <Plus size={14} className="text-amber-600" />
              <span className="text-sm font-semibold text-slate-700">New Assessment</span>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1 mb-1">
                <Bookmark size={11} /> Report Card Title
                <span className="text-slate-500 normal-case font-normal">(optional)</span>
              </label>
              <ReportCardTitlePicker
                value={newReportCardTitle}
                onChange={setNewReportCardTitle}
                userId={userId}
              />
            </div>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Assessment title"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              autoFocus
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              <div className="flex items-center gap-1.5">
                <label htmlFor="new-assessment-max-marks" className="text-xs font-medium text-slate-500 whitespace-nowrap">Max Marks</label>
                <input
                  id="new-assessment-max-marks"
                  type="number"
                  min={1}
                  value={newMaxMarks}
                  onChange={(e) => setNewMaxMarks(e.target.value)}
                  className="w-20 border border-slate-200 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                />
              </div>
              <div className="flex-1" />
              <button type="button" onClick={() => setShowNewForm(false)} className="text-sm text-slate-600 hover:text-slate-900 px-2">Cancel</button>
              <button
                type="submit"
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                disabled={!newTitle.trim() || !newMaxMarks.trim() || parseFloat(newMaxMarks) <= 0}
              >Create</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {assessments.length === 0 && (
        <div className="glass mx-2 sm:mx-0 rounded-2xl p-10 text-center">
          <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ClipboardList size={28} className="text-amber-300" />
          </div>
          <p className="text-slate-700 font-semibold mb-1">No assessments yet</p>
          <p className="text-slate-600 text-sm">{isStaff ? 'Create the first assessment above.' : 'Your teacher hasn\'t added any assessments yet.'}</p>
        </div>
      )}

      {assessments.length > 0 && (
        <div className="space-y-2">
          {assessments.map(assessment => (
            <AssessmentCard
              key={assessment.id}
              assessment={assessment}
              isStudent={isStudent}
              isStaff={isStaff}
              userId={userId}
              creatorName={creators[assessment.created_by]?.full_name ?? null}
              myMark={studentMarks[assessment.id]}
              editingId={editingId}
              editTitle={editTitle}
              editDesc={editDesc}
              editDate={editDate}
              editReportCardTitle={editReportCardTitle}
              editMaxMarks={editMaxMarks}
              editSaving={editSaving}
              onEdit={handleStartEdit}
              onDelete={handleDelete}
              onMarksheet={handleOpenMarksheet}
              onEditTitleChange={setEditTitle}
              onEditDescChange={setEditDesc}
              onEditDateChange={setEditDate}
              onEditReportCardTitleChange={setEditReportCardTitle}
              onEditMaxMarksChange={setEditMaxMarks}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={() => setEditingId(null)}
            />
          ))}
        </div>
      )}

      {/* Marksheet Modal */}
      <AnimatePresence>
        {showMarksheet && (
          <ModalShell
            onClose={() => setShowMarksheet(null)}
            size="2xl"
            title="Marksheet"
            subtitle={(() => {
              const a = assessments.find(a => a.id === showMarksheet)
              if (!a) return undefined
              const creatorName = creators[a.created_by]?.full_name
              return creatorName ? `${a.title} · Created by ${creatorName}` : a.title
            })()}
            icon={<Award size={16} />}
            iconClassName="bg-amber-100 text-amber-600"
            bodyClassName="!pt-0 !px-0"
          >
              {/* Toolbar — its own wrapping row so phones aren't cramped */}
              {students.length > 0 && (
                <div className="sticky top-0 z-20 px-5 py-2.5 bg-white/90 backdrop-blur-xl flex items-center gap-1.5 flex-wrap border-b border-slate-100">
                  <button
                    onClick={() => {
                      if (marksheetSort === 'marks') {
                        setMarksheetSortDir(d => d === 'asc' ? 'desc' : 'asc')
                      } else {
                        setMarksheetSort('marks')
                        setMarksheetSortDir('desc')
                      }
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      marksheetSort === 'marks'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    title="Sort by marks"
                  >
                    {marksheetSort === 'marks'
                      ? (marksheetSortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                      : <ArrowUpDown size={12} />}
                    Marks
                  </button>
                  <button
                    onClick={() => {
                      if (marksheetSort === 'name') {
                        setMarksheetSortDir(d => d === 'asc' ? 'desc' : 'asc')
                      } else {
                        setMarksheetSort('name')
                        setMarksheetSortDir('asc')
                      }
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      marksheetSort === 'name'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    title="Sort by name"
                  >
                    {marksheetSort === 'name'
                      ? (marksheetSortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                      : <ArrowUpDown size={12} />}
                    Name
                  </button>

                  {/* Max marks — one value for the whole assessment, editable
                      inline; never overridable per student. */}
                  <div className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-full text-xs font-semibold text-slate-700">
                    {editingMaxMarks ? (
                      <>
                        <span className="whitespace-nowrap">Max</span>
                        <input
                          type="number"
                          min={1}
                          autoFocus
                          value={maxMarksDraft}
                          onChange={(e) => setMaxMarksDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSaveMaxMarks() }
                            if (e.key === 'Escape') setEditingMaxMarks(false)
                          }}
                          className="w-14 border border-slate-300 rounded-md px-1 py-0.5 text-center focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                        <button
                          onClick={handleSaveMaxMarks}
                          disabled={savingMaxMarks || !maxMarksDraft.trim() || parseFloat(maxMarksDraft) <= 0}
                          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
                          title="Save max marks"
                        >
                          <Check size={13} />
                        </button>
                        <button onClick={() => setEditingMaxMarks(false)} className="text-slate-400 hover:text-slate-600" title="Cancel">
                          <X size={13} />
                        </button>
                      </>
                    ) : (
                      <button onClick={handleStartEditMaxMarks} className="flex items-center gap-1 hover:text-amber-700" title="Edit max marks for everyone">
                        Max {assessmentMaxMarks} <Pencil size={10} />
                      </button>
                    )}
                  </div>

                  <button
                    onClick={handleDownload}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-full text-xs font-semibold transition-colors"
                    title="Export marksheet as CSV"
                  >
                    <Download size={13} /> Export
                  </button>

                  {/* Save is repeated here so a long sheet can be saved without
                      scrolling all the way back down. */}
                  <button
                    onClick={() => handleSaveMarks(showMarksheet)}
                    disabled={saving || hasInvalidMarks}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-full text-xs font-bold shadow-md shadow-amber-500/25 active:scale-95 transition-all disabled:opacity-60 disabled:shadow-none"
                    title="Save marks"
                  >
                    <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
                {students.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">No students in this classroom</p>
                ) : (
                  (() => {
                    const sortedStudents = [...students].sort((a, b) => {
                      if (marksheetSort === 'name') {
                        const cmp = a.user.full_name.localeCompare(b.user.full_name)
                        return marksheetSortDir === 'asc' ? cmp : -cmp
                      }
                      const aM = marks[a.user_id]
                      const bM = marks[b.user_id]
                      const aPct = !aM?.isAbsent && aM?.marks !== '' && aM?.marks != null
                        ? parseFloat(aM.marks) / assessmentMaxMarks : -1
                      const bPct = !bM?.isAbsent && bM?.marks !== '' && bM?.marks != null
                        ? parseFloat(bM.marks) / assessmentMaxMarks : -1
                      return marksheetSortDir === 'asc' ? aPct - bPct : bPct - aPct
                    })
                    const order = sortedStudents.map(s => s.user_id)
                    return (
                  <>
                    {hasInvalidMarks && (
                      <div className="mx-5 mt-2.5 flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
                        <AlertTriangle size={13} className="flex-shrink-0" /> Some marks are invalid — fix them before saving.
                      </div>
                    )}

                    {/* Dense, excel-like table — small row height so far more
                        students are visible at once without scrolling. */}
                    <div className="overflow-x-auto px-5 pt-2.5 pb-1">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-600 font-bold">
                            <th className="py-1.5 pr-2 w-7 font-bold">#</th>
                            <th className="py-1.5 pr-2 font-bold">Student</th>
                            <th className="py-1.5 px-2 text-center w-28 font-bold">Marks</th>
                            <th className="py-1.5 px-2 text-center w-14 font-bold">%</th>
                            <th className="py-1.5 pl-2 text-center w-12 font-bold">AB</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedStudents.map((student, idx) => {
                            const mark = marks[student.user_id] || { marks: '', isAbsent: false }
                            const num = mark.marks !== '' ? parseFloat(mark.marks) : null
                            const pct = !mark.isAbsent && num != null && !isNaN(num)
                              ? Math.round((num / assessmentMaxMarks) * 100) : null
                            const error = !mark.isAbsent ? getMarkError(mark.marks) : null
                            return (
                              <tr
                                key={student.user_id}
                                className={`border-b border-slate-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-amber-50/40`}
                              >
                                <td className="py-1 pr-2 text-slate-500 tabular-nums align-middle">{idx + 1}</td>
                                <td className="py-1 pr-2 align-middle">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Avatar avatarUrl={student.user.avatar_url} name={student.user.full_name} size={22} userId={student.user_id} />
                                    <span className="truncate font-medium text-slate-700">{student.user.full_name}</span>
                                  </div>
                                </td>
                                <td className="py-1 px-2 align-middle">
                                  <div className="flex items-center justify-center gap-1">
                                    <input
                                      ref={(el) => { markInputRefs.current[student.user_id] = el }}
                                      type="number"
                                      min={0}
                                      max={assessmentMaxMarks}
                                      value={mark.isAbsent ? '' : mark.marks}
                                      disabled={mark.isAbsent}
                                      onChange={(e) => setMarks((prev) => ({
                                        ...prev,
                                        [student.user_id]: { ...mark, marks: e.target.value },
                                      }))}
                                      onKeyDown={(e) => handleMarkKeyDown(e, student.user_id, order)}
                                      placeholder={mark.isAbsent ? 'AB' : '—'}
                                      title={error ?? undefined}
                                      className={`w-14 border rounded-lg px-1.5 py-1 text-center tabular-nums focus:outline-none focus:ring-2 transition-colors disabled:bg-slate-100 disabled:text-slate-400 disabled:placeholder:text-slate-400 ${
                                        error
                                          ? 'border-red-300 focus:ring-red-400/50 bg-red-50/60'
                                          : 'border-slate-200 focus:ring-amber-400/50'
                                      }`}
                                    />
                                    <span className="text-slate-500">/{assessmentMaxMarks}</span>
                                  </div>
                                </td>
                                <td className="py-1 px-2 text-center align-middle">
                                  {mark.isAbsent ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-slate-200 text-slate-500">AB</span>
                                  ) : pct != null ? (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                      pct >= 80 ? 'bg-green-100 text-green-700' :
                                      pct >= 60 ? 'bg-amber-100 text-amber-700' :
                                      'bg-red-100 text-red-700'
                                    }`}>{pct}%</span>
                                  ) : <span className="text-slate-400">—</span>}
                                </td>
                                <td className="py-1 pl-2 text-center align-middle">
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    onClick={() => setMarks((prev) => ({
                                      ...prev,
                                      [student.user_id]: { marks: '', isAbsent: !mark.isAbsent },
                                    }))}
                                    className={`p-1 rounded-lg transition-colors ${
                                      mark.isAbsent
                                        ? 'bg-red-100 text-red-600 hover:bg-red-200'
                                        : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
                                    }`}
                                    title={mark.isAbsent ? 'Unmark absent' : 'Mark absent'}
                                  >
                                    <UserX size={13} />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
                      <button
                        onClick={() => handleSaveMarks(showMarksheet)}
                        disabled={saving || hasInvalidMarks}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-semibold shadow-lg shadow-amber-500/25 active:scale-[0.99] transition-all disabled:opacity-60 disabled:shadow-none"
                      >
                        <Save size={15} /> {saving ? 'Saving...' : 'Save Marks'}
                      </button>
                    </div>
                  </>
                    )
                  })()
                )}
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Assessment Card ──────────────────────────────────────────────────────────

interface AssessmentCardProps {
  assessment: ClassroomAssessment
  isStudent: boolean
  isStaff: boolean
  userId: string
  creatorName: string | null
  myMark?: AssessmentMark
  editingId: string | null
  editTitle: string
  editDesc: string
  editDate: string
  editReportCardTitle: string | null
  editMaxMarks: string
  editSaving: boolean
  onEdit: (a: ClassroomAssessment) => void
  onDelete: (id: string) => void
  onMarksheet: (id: string) => void
  onEditTitleChange: (v: string) => void
  onEditDescChange: (v: string) => void
  onEditDateChange: (v: string) => void
  onEditReportCardTitleChange: (v: string | null) => void
  onEditMaxMarksChange: (v: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}

function AssessmentCard({
  assessment, isStudent, isStaff, userId, creatorName, myMark,
  editingId, editTitle, editDesc, editDate, editReportCardTitle, editMaxMarks, editSaving,
  onEdit, onDelete, onMarksheet,
  onEditTitleChange, onEditDescChange, onEditDateChange,
  onEditReportCardTitleChange, onEditMaxMarksChange,
  onSaveEdit, onCancelEdit,
}: AssessmentCardProps) {
  const isEditing = editingId === assessment.id

  const pct = myMark && !myMark.is_absent && myMark.marks != null
    ? Math.round((myMark.marks / myMark.max_marks) * 100)
    : null

  return (
    <div
      className={`bg-white border-y sm:border sm:rounded-2xl border-slate-300 sm:shadow-sm transition-all ${
        isStaff && !isEditing ? 'cursor-pointer hover:shadow-md hover:border-slate-400' : ''
      }`}
      onClick={isStaff && !isEditing ? () => onMarksheet(assessment.id) : undefined}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="p-2 rounded-xl flex-shrink-0 bg-slate-100">
            <ClipboardList size={16} className="text-slate-500" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-800 text-sm">{assessment.title}</h3>
              {assessment.report_card_title && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-semibold">
                  <Bookmark size={9} /> {assessment.report_card_title}
                </span>
              )}
              <span className="inline-flex items-center text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full font-semibold">
                Max {assessment.max_marks}
              </span>
              {creatorName && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-medium">
                  <User size={9} /> {creatorName}
                </span>
              )}
            </div>
            {assessment.description && (
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{assessment.description}</p>
            )}
            {assessment.date && (
              <p className="text-xs text-slate-600 mt-1 flex items-center gap-1">
                <Calendar size={11} />
                {new Date(assessment.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}

            {/* Student: marks display */}
            {isStudent && myMark && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-baseline gap-1 px-3 py-1.5 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-lg font-bold text-slate-800">{myMark.is_absent ? 'AB' : myMark.marks ?? '—'}</span>
                  {!myMark.is_absent && <span className="text-xs text-slate-500">/ {myMark.max_marks}</span>}
                </div>
                {pct != null && (
                  <span className={`text-sm font-bold px-2.5 py-1 rounded-xl ${
                    pct >= 80 ? 'bg-green-100 text-green-700' :
                    pct >= 60 ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {pct}%
                  </span>
                )}
              </div>
            )}
            {isStudent && !myMark && (
              <p className="text-xs text-slate-500 mt-2 italic">Marks not yet available</p>
            )}
          </div>

          {/* Staff actions */}
          {isStaff && (
            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => onEdit(assessment)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Edit3 size={13} />
              </button>
              <button
                onClick={() => onDelete(assessment.id)}
                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Inline edit form */}
        <AnimatePresence>
          {isEditing && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 pt-3 border-t border-slate-100 space-y-2"
              onClick={e => e.stopPropagation()}
            >
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1 mb-1">
                  <Bookmark size={10} /> Report Card Title
                  <span className="text-slate-400 normal-case font-normal">(optional)</span>
                </label>
                <ReportCardTitlePicker
                  value={editReportCardTitle}
                  onChange={onEditReportCardTitleChange}
                  userId={userId}
                />
              </div>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => onEditTitleChange(e.target.value)}
                placeholder="Assessment title"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              <textarea
                value={editDesc}
                onChange={(e) => onEditDescChange(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => onEditDateChange(e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                />
                <div className="flex items-center gap-1.5">
                  <label htmlFor={`edit-max-marks-${assessment.id}`} className="text-xs font-medium text-slate-500 whitespace-nowrap">Max Marks</label>
                  <input
                    id={`edit-max-marks-${assessment.id}`}
                    type="number"
                    min={1}
                    value={editMaxMarks}
                    onChange={(e) => onEditMaxMarksChange(e.target.value)}
                    className="w-20 border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                </div>
                <div className="flex-1" />
                <button onClick={onCancelEdit} className="text-sm text-slate-600 hover:text-slate-900 px-2">Cancel</button>
                <button
                  onClick={onSaveEdit}
                  disabled={editSaving || !editTitle.trim() || !editMaxMarks.trim() || parseFloat(editMaxMarks) <= 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Save size={13} /> {editSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
