'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, ClipboardList, Calendar, Save, Edit3, Award, Download, Bookmark, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import {
  ClassroomAssessment, AssessmentMark,
  createAssessment, fetchAssessments, deleteAssessment, updateAssessment,
  upsertAssessmentMark, fetchAssessmentMarks, fetchStudentMembers,
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
  const [marks, setMarks] = useState<Record<string, { marks: string; max_marks: string }>>({})
  const [students, setStudents] = useState<(ClassroomMember & { user: UserProfile })[]>([])
  const [saving, setSaving] = useState(false)
  const [bulkMax, setBulkMax] = useState('')
  const [marksheetSort, setMarksheetSort] = useState<'name' | 'marks'>('name')
  const [marksheetSortDir, setMarksheetSortDir] = useState<'asc' | 'desc'>('asc')

  // Edit assessment state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editReportCardTitle, setEditReportCardTitle] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // New assessment form
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newReportCardTitle, setNewReportCardTitle] = useState<string | null>(null)

  const isStudent = userRole === 'student'
  const isStaff = ['teacher', 'coordinator', 'principal', 'admin'].includes(userRole)

  const loadAssessments = useCallback(async () => {
    setLoading(true)
    const data = await fetchAssessments(classroomId)
    setAssessments(data)
    setLoading(false)
  }, [classroomId])

  useEffect(() => { loadAssessments() }, [loadAssessments])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return

    const result = await createAssessment({
      classroom_id: classroomId,
      title: newTitle.trim(),
      description: newDesc.trim() || undefined,
      date: newDate || undefined,
      tag: 'other',
      report_card_title: newReportCardTitle,
    }, userId)

    if (result) {
      setAssessments((prev) => [result, ...prev])
      setNewTitle('')
      setNewDesc('')
      setNewDate('')
      setNewReportCardTitle(null)
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
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editTitle.trim()) return
    setEditSaving(true)
    const ok = await updateAssessment(editingId, {
      title: editTitle.trim(),
      description: editDesc.trim() || undefined,
      date: editDate || undefined,
      report_card_title: editReportCardTitle,
    })
    if (ok) {
      setAssessments(prev => prev.map(a => a.id === editingId
        ? {
            ...a,
            title: editTitle.trim(),
            description: editDesc.trim() || null,
            date: editDate || null,
            report_card_title: editReportCardTitle,
          }
        : a
      ))
      setEditingId(null)
    }
    setEditSaving(false)
  }

  const handleOpenMarksheet = async (assessmentId: string) => {
    setShowMarksheet(assessmentId)
    const [existingMarks, studentList] = await Promise.all([
      fetchAssessmentMarks(assessmentId),
      fetchStudentMembers(classroomId),
    ])
    setStudents(studentList)

    const marksMap: Record<string, { marks: string; max_marks: string }> = {}
    for (const student of studentList) {
      const existing = existingMarks.find((m) => m.student_id === student.user_id)
      marksMap[student.user_id] = {
        marks: existing?.marks != null ? String(existing.marks) : '',
        max_marks: existing?.max_marks != null ? String(existing.max_marks) : '100',
      }
    }
    setMarks(marksMap)
  }

  const handleDownload = () => {
    const assessment = assessments.find(a => a.id === showMarksheet)
    if (!assessment || students.length === 0) return
    const rows: string[][] = [['Student', 'Marks', 'Out of', 'Percentage']]
    for (const student of students) {
      const mark = marks[student.user_id] || { marks: '', max_marks: '100' }
      const num = mark.marks !== '' ? parseFloat(mark.marks) : null
      const maxNum = parseFloat(mark.max_marks) || 100
      const pct = num != null && !isNaN(num) ? `${Math.round((num / maxNum) * 100)}%` : ''
      rows.push([student.user.full_name, mark.marks, String(maxNum), pct])
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

  const handleSaveMarks = async (assessmentId: string) => {
    setSaving(true)
    for (const [studentId, mark] of Object.entries(marks)) {
      const marksVal = mark.marks.trim() === '' ? null : parseFloat(mark.marks)
      const maxMarksVal = parseFloat(mark.max_marks) || 100
      await upsertAssessmentMark(assessmentId, studentId, marksVal, maxMarksVal)
    }
    setSaving(false)
    setShowMarksheet(null)
  }

  // Student view: fetch own marks
  const [studentMarks, setStudentMarks] = useState<Record<string, AssessmentMark>>({})
  useEffect(() => {
    if (isStudent && assessments.length > 0) {
      const loadMarks = async () => {
        for (const a of assessments) {
          const allMarks = await fetchAssessmentMarks(a.id)
          const mine = allMarks.find((m) => m.student_id === userId)
          if (mine) setStudentMarks((prev) => ({ ...prev, [a.id]: mine }))
        }
      }
      loadMarks()
    }
  }, [isStudent, assessments, userId])

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-500">Loading assessments...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-100 rounded-xl">
            <ClipboardList size={16} className="text-amber-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800 text-sm">Assessments</h2>
            <p className="text-xs text-slate-400">{assessments.length} total</p>
          </div>
        </div>
        {isStaff && (
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
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
            className="glass rounded-2xl p-4 space-y-3 border border-amber-100"
          >
            <div className="flex items-center gap-2 mb-1">
              <Plus size={14} className="text-amber-600" />
              <span className="text-sm font-semibold text-slate-700">New Assessment</span>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1 mb-1">
                <Bookmark size={11} /> Report Card Title
                <span className="text-slate-400 normal-case font-normal">(optional)</span>
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
              <div className="flex-1" />
              <button type="button" onClick={() => setShowNewForm(false)} className="text-sm text-slate-400 hover:text-slate-600 px-2">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50" disabled={!newTitle.trim()}>Create</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {assessments.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center">
          <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ClipboardList size={28} className="text-amber-300" />
          </div>
          <p className="text-slate-600 font-medium mb-1">No assessments yet</p>
          <p className="text-slate-400 text-sm">{isStaff ? 'Create the first assessment above.' : 'Your teacher hasn\'t added any assessments yet.'}</p>
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
              myMark={studentMarks[assessment.id]}
              editingId={editingId}
              editTitle={editTitle}
              editDesc={editDesc}
              editDate={editDate}
              editReportCardTitle={editReportCardTitle}
              editSaving={editSaving}
              onEdit={handleStartEdit}
              onDelete={handleDelete}
              onMarksheet={handleOpenMarksheet}
              onEditTitleChange={setEditTitle}
              onEditDescChange={setEditDesc}
              onEditDateChange={setEditDate}
              onEditReportCardTitleChange={setEditReportCardTitle}
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
            size="lg"
            title="Marksheet"
            subtitle={assessments.find(a => a.id === showMarksheet)?.title}
            icon={<Award size={16} />}
            iconClassName="bg-amber-100 text-amber-600"
            bodyClassName="!pt-0 space-y-2"
          >
              {/* Toolbar — its own wrapping row so phones aren't cramped */}
              {students.length > 0 && (
                <div className="sticky top-0 z-10 -mx-5 px-5 py-2.5 bg-white/90 backdrop-blur-xl flex items-center gap-1.5 flex-wrap border-b border-slate-50">
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
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    title="Sort by name"
                  >
                    {marksheetSort === 'name'
                      ? (marksheetSortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                      : <ArrowUpDown size={12} />}
                    Name
                  </button>
                  <button
                    onClick={handleDownload}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-full text-xs font-semibold transition-colors"
                    title="Export marksheet as CSV"
                  >
                    <Download size={13} /> Export
                  </button>
                </div>
              )}
                {students.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No students in this classroom</p>
                ) : (
                  (() => {
                    const sortedStudents = [...students].sort((a, b) => {
                      if (marksheetSort === 'name') {
                        const cmp = a.user.full_name.localeCompare(b.user.full_name)
                        return marksheetSortDir === 'asc' ? cmp : -cmp
                      }
                      const aM = marks[a.user_id]
                      const bM = marks[b.user_id]
                      const aPct = aM?.marks !== '' && aM?.marks != null
                        ? parseFloat(aM.marks) / (parseFloat(aM.max_marks) || 100) : -1
                      const bPct = bM?.marks !== '' && bM?.marks != null
                        ? parseFloat(bM.marks) / (parseFloat(bM.max_marks) || 100) : -1
                      return marksheetSortDir === 'asc' ? aPct - bPct : bPct - aPct
                    })
                    return (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100 mb-1">
                      <span className="text-xs font-medium text-amber-700 whitespace-nowrap">Set max for all:</span>
                      <input
                        type="number"
                        value={bulkMax}
                        onChange={(e) => setBulkMax(e.target.value)}
                        placeholder="e.g. 100"
                        className="w-20 border border-amber-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                      />
                      <button
                        onClick={() => {
                          if (!bulkMax.trim()) return
                          setMarks(prev => {
                            const updated = { ...prev }
                            students.forEach(s => {
                              updated[s.user_id] = { ...(updated[s.user_id] || { marks: '' }), max_marks: bulkMax }
                            })
                            return updated
                          })
                        }}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition-colors"
                      >Apply</button>
                    </div>
                    {sortedStudents.map((student) => {
                      const mark = marks[student.user_id] || { marks: '', max_marks: '100' }
                      const num = mark.marks !== '' ? parseFloat(mark.marks) : null
                      const pct = num != null && !isNaN(num) ? Math.round((num / (parseFloat(mark.max_marks) || 100)) * 100) : null
                      return (
                        <div key={student.user_id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                          <Avatar avatarUrl={student.user.avatar_url} name={student.user.full_name} size={32} userId={student.user_id} />
                          <span className="flex-1 text-sm font-medium text-slate-700 truncate">{student.user.full_name}</span>
                          {pct != null && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium mr-1 ${
                              pct >= 80 ? 'bg-green-100 text-green-700' :
                              pct >= 60 ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-700'
                            }`}>{pct}%</span>
                          )}
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={mark.marks}
                              onChange={(e) => setMarks((prev) => ({
                                ...prev,
                                [student.user_id]: { ...mark, marks: e.target.value },
                              }))}
                              placeholder="—"
                              className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                            />
                            <span className="text-slate-400 text-sm">/</span>
                            <input
                              type="number"
                              value={mark.max_marks}
                              onChange={(e) => setMarks((prev) => ({
                                ...prev,
                                [student.user_id]: { ...mark, max_marks: e.target.value },
                              }))}
                              className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                            />
                          </div>
                        </div>
                      )
                    })}
                    <button
                      onClick={() => handleSaveMarks(showMarksheet)}
                      disabled={saving}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-semibold shadow-lg shadow-amber-500/25 active:scale-[0.99] transition-all mt-3 disabled:opacity-60 disabled:shadow-none"
                    >
                      <Save size={15} /> {saving ? 'Saving...' : 'Save Marks'}
                    </button>
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
  myMark?: AssessmentMark
  editingId: string | null
  editTitle: string
  editDesc: string
  editDate: string
  editReportCardTitle: string | null
  editSaving: boolean
  onEdit: (a: ClassroomAssessment) => void
  onDelete: (id: string) => void
  onMarksheet: (id: string) => void
  onEditTitleChange: (v: string) => void
  onEditDescChange: (v: string) => void
  onEditDateChange: (v: string) => void
  onEditReportCardTitleChange: (v: string | null) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}

function AssessmentCard({
  assessment, isStudent, isStaff, userId, myMark,
  editingId, editTitle, editDesc, editDate, editReportCardTitle, editSaving,
  onEdit, onDelete, onMarksheet,
  onEditTitleChange, onEditDescChange, onEditDateChange,
  onEditReportCardTitleChange,
  onSaveEdit, onCancelEdit,
}: AssessmentCardProps) {
  const isEditing = editingId === assessment.id

  const pct = myMark && myMark.marks != null
    ? Math.round((myMark.marks / myMark.max_marks) * 100)
    : null

  return (
    <div
      className={`glass rounded-2xl border border-slate-100 transition-all ${
        isStaff && !isEditing ? 'cursor-pointer hover:shadow-md' : ''
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
            </div>
            {assessment.description && (
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{assessment.description}</p>
            )}
            {assessment.date && (
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                <Calendar size={11} />
                {new Date(assessment.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}

            {/* Student: marks display */}
            {isStudent && myMark && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-baseline gap-1 px-3 py-1.5 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-lg font-bold text-slate-800">{myMark.marks ?? '—'}</span>
                  <span className="text-xs text-slate-400">/ {myMark.max_marks}</span>
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
              <p className="text-xs text-slate-400 mt-2 italic">Marks not yet available</p>
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
                <div className="flex-1" />
                <button onClick={onCancelEdit} className="text-sm text-slate-400 hover:text-slate-600 px-2">Cancel</button>
                <button
                  onClick={onSaveEdit}
                  disabled={editSaving || !editTitle.trim()}
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
