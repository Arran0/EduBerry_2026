'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, ClipboardList, Calendar, Save, Edit3, Award, Download, Bookmark, ArrowUpDown, ChevronUp, ChevronDown, UserX, AlertTriangle, Pencil, Check, X, User, SplitSquareHorizontal, Scale, FileInput, Loader2, Search } from 'lucide-react'
import {
  ClassroomAssessment, AssessmentMark, AssessmentComponent, AssessmentComponentMark,
  createAssessment, fetchAssessments, deleteAssessment, updateAssessment,
  upsertAssessmentMarks, fetchAssessmentMarks, fetchStudentAssessmentMarks, fetchStudentMembers, fetchProfilesByIds,
  fetchAssessmentComponents, fetchAssessmentComponentMarks, fetchStudentComponentMarks,
  saveAssessmentComponents, upsertAssessmentComponentMarks,
  ClassroomMember, ClassroomWithDetails,
} from '@/lib/classrooms'
import { UserRole, UserProfile } from '@/lib/supabase'
import { rescaleMark } from '@/lib/reportCardGrading'
import Avatar from '@/components/Avatar'
import ReportCardTitlePicker from '@/components/classrooms/ReportCardTitlePicker'
import ModalShell from '@/components/ui/ModalShell'
import { askConfirm } from '@/components/ui/sheet'
import {
  AssessmentListSkeleton, ScoreBlockSkeleton, Sk, SkText, SkAvatar, SkeletonRegion, skeletonRowCount,
} from '@/components/classrooms/ClassroomSkeletons'

interface AssessmentsTabProps {
  classroomId: string
  userId: string
  userRole: UserRole
  classroom: ClassroomWithDetails
}

/** Another marksheet in the same classroom, captured to fill a component from.
 *  The marks are held at the scale they were awarded at (`sourceMax`) so that
 *  re-weighting the component can rescale them from the original figures rather
 *  than compounding one rounding on top of another. */
interface ImportedMarksheet {
  title: string
  sourceMax: number
  /** studentId → that student's result in the source assessment. */
  marks: Record<string, { marks: number | null; isAbsent: boolean }>
}

/** A row in the component editor. `id` is present for a component that already
 *  exists, so editing its name or weight keeps the marks already entered
 *  against it; the strings are what the two inputs hold mid-edit. */
interface ComponentDraftRow {
  id?: string
  name: string
  maxMarks: string
  /** Set when the row was filled from another marksheet rather than typed. */
  imported?: ImportedMarksheet
}

/** Sums the marks typed across an assessment's components. Returns null when
 *  every cell is blank, which is not the same as a total of zero. */
function componentRowTotal(
  cells: Record<string, string> | undefined,
  components: AssessmentComponent[],
): number | null {
  let total = 0
  let entered = false
  for (const c of components) {
    const raw = cells?.[c.id] ?? ''
    if (raw.trim() === '') continue
    const n = parseFloat(raw)
    if (isNaN(n)) continue
    total += n
    entered = true
  }
  return entered ? total : null
}

/**
 * A stable fingerprint of everything the marksheet edits, so leaving it can
 * tell whether anything actually changed. Built by walking students and
 * components in order rather than serialising the state objects, whose key
 * order is an implementation detail.
 */
export function marksheetSnapshot(
  studentList: (ClassroomMember & { user: UserProfile })[],
  comps: AssessmentComponent[],
  marks: Record<string, { marks: string; isAbsent: boolean }>,
  componentMarks: Record<string, Record<string, string>>,
): string {
  return studentList.map(s => {
    const m = marks[s.user_id]
    const total = m?.isAbsent ? 'AB' : (m?.marks ?? '').trim()
    const cells = comps.map(c => (componentMarks[s.user_id]?.[c.id] ?? '').trim()).join(',')
    return `${s.user_id}:${total}|${cells}`
  }).join(';')
}

/** A mark cell is invalid if it is not a number, is negative, or overshoots the
 *  maximum it is being marked out of. A blank cell is simply not entered yet. */
function markError(value: string, max: number): string | null {
  if (value.trim() === '') return null
  const n = parseFloat(value)
  if (isNaN(n)) return 'Invalid number'
  if (n < 0) return 'Cannot be negative'
  if (n > max) return `Cannot exceed ${max}`
  return null
}

export default function AssessmentsTab({ classroomId, userId, userRole, classroom }: AssessmentsTabProps) {
  const [assessments, setAssessments] = useState<ClassroomAssessment[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [showMarksheet, setShowMarksheet] = useState<string | null>(null)
  const [marks, setMarks] = useState<Record<string, { marks: string; isAbsent: boolean }>>({})
  const [students, setStudents] = useState<(ClassroomMember & { user: UserProfile })[]>([])
  // True from opening a marksheet until its students and marks are in: the
  // sheet shows a skeleton meanwhile, never the previous sheet's roster.
  const [marksheetLoading, setMarksheetLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Assessment creators, keyed by id — shown on the assessment's card and in
  // the marksheet header so staff can see who set it up.
  const [creators, setCreators] = useState<Record<string, UserProfile>>({})
  // Components of every assessment on the tab, keyed by assessment id.
  const [componentsByAssessment, setComponentsByAssessment] = useState<Record<string, AssessmentComponent[]>>({})
  const [marksheetSort, setMarksheetSort] = useState<'name' | 'marks'>('name')
  const [marksheetSortDir, setMarksheetSortDir] = useState<'asc' | 'desc'>('asc')

  // Max marks for the currently open marksheet — one value, shared by every
  // student in the assessment (requirement: uniform, not per-student).
  const [assessmentMaxMarks, setAssessmentMaxMarks] = useState<number>(100)
  const [editingMaxMarks, setEditingMaxMarks] = useState(false)
  const [maxMarksDraft, setMaxMarksDraft] = useState('')
  const [savingMaxMarks, setSavingMaxMarks] = useState(false)

  // Components of the open marksheet — "Lab" out of 20, "Examination" out of
  // 80. Empty means the assessment is scored as a single mark, the way every
  // assessment was before components existed.
  const [components, setComponents] = useState<AssessmentComponent[]>([])
  /** componentMarks[studentId][componentId] = what is typed in that cell. */
  const [componentMarks, setComponentMarks] = useState<Record<string, Record<string, string>>>({})
  const [showComponentEditor, setShowComponentEditor] = useState(false)
  const [componentDrafts, setComponentDrafts] = useState<ComponentDraftRow[]>([])
  const [savingComponents, setSavingComponents] = useState(false)
  // Which draft row has its "import from another marksheet" picker open, and
  // what is typed into it. One at a time — the picker is a focused choice.
  const [importPickerRow, setImportPickerRow] = useState<number | null>(null)
  const [importQuery, setImportQuery] = useState('')
  const [importingFrom, setImportingFrom] = useState<string | null>(null)

  // Total conversion — the optional second maximum the marks are reported at.
  const [conversionTotal, setConversionTotal] = useState<number | null>(null)
  const [editingConversion, setEditingConversion] = useState(false)
  const [conversionDraft, setConversionDraft] = useState('')
  const [savingConversion, setSavingConversion] = useState(false)

  // The sheet as it was last read from (or written to) the database. Anything
  // that differs from this is unsaved work, and closing asks about it.
  const savedSnapshot = useRef('')
  const [confirmingClose, setConfirmingClose] = useState(false)

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

  // Refs to every mark <input>, so Tab/Enter can jump straight to the next
  // field for fast, spreadsheet-like entry. Keyed by student id on a plain
  // sheet, and by "studentId:componentId" once the assessment is split.
  const markInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const loadAssessments = useCallback(async () => {
    setLoading(true)
    const data = await fetchAssessments(classroomId)
    setAssessments(data)
    setLoading(false)
    fetchProfilesByIds(data.map(a => a.created_by)).then(setCreators)
    // Every card shows how its assessment is split, staff and student alike —
    // the marks behind the split are fetched per viewer further down.
    fetchAssessmentComponents(data.map(a => a.id)).then(setComponentsByAssessment)
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
    if (!(await askConfirm({ title: 'Delete this assessment?', body: 'Its marks are deleted with it.', danger: true }))) return
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
    setShowComponentEditor(false)
    const assessment = assessments.find(a => a.id === assessmentId)
    setAssessmentMaxMarks(assessment?.max_marks ?? 100)
    setConversionTotal(assessment?.conversion_total != null ? Number(assessment.conversion_total) : null)
    setEditingConversion(false)
    setImportPickerRow(null)
    setImportQuery('')
    // Clear the previous sheet's split before its replacement arrives, so the
    // columns on screen never belong to a different assessment than the marks
    // under them. What is already known locally goes straight in.
    const known = componentsByAssessment[assessmentId] ?? []
    setComponents(known)
    setComponentMarks({})
    setMarksheetLoading(true)

    const [existingMarks, studentList, fetchedComponents, existingComponentMarks] = await Promise.all([
      fetchAssessmentMarks(assessmentId),
      fetchStudentMembers(classroomId),
      fetchAssessmentComponents([assessmentId]),
      fetchAssessmentComponentMarks(assessmentId),
    ])
    setStudents(studentList)

    const comps = fetchedComponents[assessmentId] ?? []
    setComponents(comps)
    setComponentsByAssessment(prev => ({ ...prev, [assessmentId]: comps }))
    setComponentDrafts(comps.map(c => ({ id: c.id, name: c.name, maxMarks: String(c.max_marks) })))
    if (comps.length > 0) {
      setAssessmentMaxMarks(comps.reduce((s, c) => s + Number(c.max_marks), 0))
    }

    fillSheet(studentList, comps, existingMarks, existingComponentMarks)
    setMarksheetLoading(false)
  }

  /** Lays stored marks into the two grids the sheet edits.
   *
   *  Absence is recorded per component but toggled for the whole row, so the
   *  total row — which the database derives from the components — is the honest
   *  source for it. That is also why this runs after an import rather than the
   *  UI predicting what the derivation will produce. */
  const fillSheet = (
    studentList: (ClassroomMember & { user: UserProfile })[],
    comps: AssessmentComponent[],
    totals: AssessmentMark[],
    componentMarkRows: AssessmentComponentMark[],
  ) => {
    const marksMap: Record<string, { marks: string; isAbsent: boolean }> = {}
    const componentMap: Record<string, Record<string, string>> = {}
    const byKey = new Map<string, AssessmentComponentMark>(
      componentMarkRows.map(m => [`${m.component_id}:${m.student_id}`, m])
    )
    for (const student of studentList) {
      const existing = totals.find((m) => m.student_id === student.user_id)
      marksMap[student.user_id] = {
        marks: existing?.marks != null ? String(existing.marks) : '',
        isAbsent: existing?.is_absent ?? false,
      }
      const cells: Record<string, string> = {}
      for (const c of comps) {
        const cm = byKey.get(`${c.id}:${student.user_id}`)
        cells[c.id] = cm && !cm.is_absent && cm.marks != null ? String(cm.marks) : ''
      }
      componentMap[student.user_id] = cells
    }
    setMarks(marksMap)
    setComponentMarks(componentMap)
    savedSnapshot.current = marksheetSnapshot(studentList, comps, marksMap, componentMap)
  }

  const handleDownload = () => {
    const assessment = assessments.find(a => a.id === showMarksheet)
    if (!assessment || students.length === 0) return
    // A split assessment exports one column per component before the total, so
    // the spreadsheet carries the same breakdown the marksheet shows.
    const rows: string[][] = [[
      'Student',
      ...components.map(c => `${c.name} (out of ${c.max_marks})`),
      'Marks',
      'Out of',
      ...(conversionTotal != null ? [`Converted (out of ${conversionTotal})`] : []),
      'Percentage',
    ]]
    for (const student of students) {
      const mark = marks[student.user_id] || { marks: '', isAbsent: false }
      const num = components.length > 0
        ? componentRowTotal(componentMarks[student.user_id], components)
        : (mark.marks !== '' ? parseFloat(mark.marks) : null)
      const pct = !mark.isAbsent && num != null && !isNaN(num) ? `${Math.round((num / assessmentMaxMarks) * 100)}%` : ''
      const converted = conversionTotal != null && !mark.isAbsent && num != null && !isNaN(num)
        ? rescaleMark(num, assessmentMaxMarks, conversionTotal)
        : null
      rows.push([
        student.user.full_name,
        ...components.map(c => mark.isAbsent ? 'AB' : (componentMarks[student.user_id]?.[c.id] ?? '')),
        mark.isAbsent ? 'AB' : (num != null ? String(num) : ''),
        String(assessmentMaxMarks),
        ...(conversionTotal != null
          ? [mark.isAbsent ? 'AB' : (converted != null ? String(converted) : '')]
          : []),
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
  const getMarkError = useCallback(
    (value: string): string | null => markError(value, assessmentMaxMarks),
    [assessmentMaxMarks],
  )

  const hasInvalidMarks = components.length > 0
    ? students.some(s => {
        if (marks[s.user_id]?.isAbsent) return false
        return components.some(c =>
          markError(componentMarks[s.user_id]?.[c.id] ?? '', Number(c.max_marks)) != null
        )
      })
    : Object.values(marks).some((m) => !m.isAbsent && getMarkError(m.marks) != null)

  const handleSaveMarks = async (assessmentId: string) => {
    if (hasInvalidMarks) return
    setSaving(true)

    if (components.length > 0) {
      // Only the parts are written: the database adds them into the
      // assessment total, so no client can leave the two disagreeing.
      const entries = students.flatMap(student => {
        const isAbsent = marks[student.user_id]?.isAbsent ?? false
        return components.map(c => {
          const raw = componentMarks[student.user_id]?.[c.id] ?? ''
          return {
            componentId: c.id,
            studentId: student.user_id,
            marks: isAbsent || raw.trim() === '' ? null : parseFloat(raw),
            isAbsent,
          }
        })
      })
      await upsertAssessmentComponentMarks(entries)
    } else {
      await upsertAssessmentMarks(assessmentId, Object.entries(marks).map(([studentId, mark]) => ({
        studentId,
        marks: mark.isAbsent || mark.marks.trim() === '' ? null : parseFloat(mark.marks),
        maxMarks: assessmentMaxMarks,
        isAbsent: mark.isAbsent,
      })))
    }

    savedSnapshot.current = marksheetSnapshot(students, components, marks, componentMarks)
    setSaving(false)
    setShowMarksheet(null)
    setConfirmingClose(false)
  }

  /** True when the sheet on screen differs from what is stored. A sheet still
   *  loading holds nothing typed yet, so closing it never asks. */
  const hasUnsavedMarks = showMarksheet != null && !marksheetLoading
    && marksheetSnapshot(students, components, marks, componentMarks) !== savedSnapshot.current

  /** Closing a marksheet with marks typed into it and never saved is the one
   *  mistake here that silently loses a teacher's work, so it asks first. */
  const requestCloseMarksheet = () => {
    if (hasUnsavedMarks) { setConfirmingClose(true); return }
    setShowMarksheet(null)
  }

  const discardAndClose = () => {
    setConfirmingClose(false)
    setShowMarksheet(null)
  }

  // ── Component editor ──

  const componentDraftMax = componentDrafts.reduce((sum, d) => {
    const n = parseFloat(d.maxMarks)
    return sum + (isFinite(n) && n > 0 ? n : 0)
  }, 0)

  const componentDraftError = (() => {
    const named = componentDrafts.filter(d => d.name.trim() !== '')
    if (componentDrafts.some(d => d.name.trim() === '')) return 'Every component needs a name.'
    if (componentDrafts.some(d => !(parseFloat(d.maxMarks) > 0))) return 'Every component needs a maximum above zero.'
    const lowered = named.map(d => d.name.trim().toLowerCase())
    if (new Set(lowered).size !== lowered.length) return 'Component names must be different.'
    return null
  })()

  const handleSaveComponents = async () => {
    if (!showMarksheet || componentDraftError) return

    // Dropping a component takes its marks with it, so say so before it
    // happens rather than after.
    const removed = components.filter(c => !componentDrafts.some(d => d.id === c.id))
    if (removed.length > 0 && !(await askConfirm({
      title: `Remove ${removed.length === 1 ? 'a component' : `${removed.length} components`}?`,
      body: `Removing ${removed.map(c => `“${c.name}”`).join(', ')} deletes the marks entered for ${removed.length === 1 ? 'it' : 'them'}.`,
      confirmLabel: 'Remove',
      danger: true,
    }))) return

    setSavingComponents(true)
    const saved = await saveAssessmentComponents(
      showMarksheet,
      componentDrafts.map(d => ({ id: d.id, name: d.name, max_marks: parseFloat(d.maxMarks) })),
    )
    if (!saved) { setSavingComponents(false); return }

    // Imported rows bring their source's marks with them, rescaled if the
    // component was given a different weight than the marksheet was marked at.
    // Names are unique per assessment, which is what lets a draft be matched to
    // the row that came back.
    const savedByName = new Map(saved.map(c => [c.name, c]))
    const importedEntries: {
      componentId: string; studentId: string; marks: number | null; isAbsent: boolean
    }[] = []

    for (const draft of componentDrafts) {
      if (!draft.imported) continue
      const component = savedByName.get(draft.name.trim())
      if (!component) continue
      for (const student of students) {
        const source = draft.imported.marks[student.user_id]
        if (!source) continue
        importedEntries.push({
          componentId: component.id,
          studentId: student.user_id,
          // Scaled from the source's own figures, so re-weighting twice never
          // compounds one rounding on top of another.
          marks: source.isAbsent
            ? null
            : rescaleMark(source.marks, draft.imported.sourceMax, Number(component.max_marks)),
          isAbsent: source.isAbsent,
        })
      }
    }

    if (importedEntries.length > 0) {
      await upsertAssessmentComponentMarks(importedEntries)
    }

    setComponents(saved)
    setComponentDrafts(saved.map(c => ({ id: c.id, name: c.name, maxMarks: String(c.max_marks) })))
    setComponentsByAssessment(prev => ({ ...prev, [showMarksheet]: saved }))
    setShowComponentEditor(false)

    if (importedEntries.length > 0) {
      // An import writes marks, and the database derives the totals (and the
      // absences) from them. Read both back rather than predicting what that
      // derivation produced — a guess that is even slightly off would be
      // written straight back out by the next Save Marks.
      const [totals, componentMarkRows] = await Promise.all([
        fetchAssessmentMarks(showMarksheet),
        fetchAssessmentComponentMarks(showMarksheet),
      ])
      fillSheet(students, saved, totals, componentMarkRows)
    } else {
      // Nothing was written, so the typed cells stand: keep the ones whose
      // component survived and give any new component a blank column.
      setComponentMarks(prev => {
        const next: Record<string, Record<string, string>> = {}
        for (const student of students) {
          const cells: Record<string, string> = {}
          for (const c of saved) cells[c.id] = prev[student.user_id]?.[c.id] ?? ''
          next[student.user_id] = cells
        }
        return next
      })
    }
    setSavingComponents(false)

    // The assessment's max is now the sum of its parts (or, once the last
    // component goes, whatever it was before the split).
    const newMax = saved.length > 0
      ? saved.reduce((s, c) => s + Number(c.max_marks), 0)
      : assessmentMaxMarks
    setAssessmentMaxMarks(newMax)
    setAssessments(prev => prev.map(a => a.id === showMarksheet ? { ...a, max_marks: newMax } : a))
  }

  /** Other marksheets in this classroom, ranked against what is typed in the
   *  picker. An assessment cannot be imported into itself. */
  const importCandidates = (() => {
    const q = importQuery.trim().toLowerCase()
    return assessments
      .filter(a => a.id !== showMarksheet)
      .filter(a => q === '' || a.title.toLowerCase().includes(q) || (a.report_card_title ?? '').toLowerCase().includes(q))
      // A title that starts with what was typed is the likelier match, so it
      // sorts above one that merely contains it.
      .sort((a, b) => {
        if (q !== '') {
          const aStarts = a.title.toLowerCase().startsWith(q)
          const bStarts = b.title.toLowerCase().startsWith(q)
          if (aStarts !== bStarts) return aStarts ? -1 : 1
        }
        return (b.date ?? '').localeCompare(a.date ?? '')
      })
      .slice(0, 8)
  })()

  /** Fills a component row from another marksheet: its title, its maximum, and
   *  every student's result. The marks are not written until the component set
   *  is saved, so the weight can still be changed first. */
  const handleImportMarksheet = async (rowIndex: number, source: ClassroomAssessment) => {
    setImportingFrom(source.id)
    const sourceMarks = await fetchAssessmentMarks(source.id)
    setImportingFrom(null)

    const marks: ImportedMarksheet['marks'] = {}
    for (const m of sourceMarks) {
      marks[m.student_id] = { marks: m.marks != null ? Number(m.marks) : null, isAbsent: m.is_absent }
    }

    setComponentDrafts(prev => prev.map((d, i) => i === rowIndex ? {
      ...d,
      // A name already typed is the teacher's own wording, so it is kept.
      name: d.name.trim() === '' ? source.title : d.name,
      // Default the weight to what the marksheet was marked out of; changing
      // it afterwards rescales the marks to fit.
      maxMarks: String(Number(source.max_marks)),
      imported: {
        title: source.title,
        sourceMax: Number(source.max_marks),
        marks,
      },
    } : d))
    setImportPickerRow(null)
    setImportQuery('')
  }

  const handleStartEditConversion = () => {
    setConversionDraft(conversionTotal != null ? String(conversionTotal) : '')
    setEditingConversion(true)
  }

  /** Saves the conversion total, or clears it when the field is left empty. */
  const handleSaveConversion = async () => {
    if (!showMarksheet) return
    const raw = conversionDraft.trim()
    const next = raw === '' ? null : parseFloat(raw)
    if (next != null && (!isFinite(next) || next <= 0)) return

    setSavingConversion(true)
    const ok = await updateAssessment(showMarksheet, { conversion_total: next })
    if (ok) {
      setConversionTotal(next)
      setAssessments(prev => prev.map(a => a.id === showMarksheet ? { ...a, conversion_total: next } : a))
      setEditingConversion(false)
    }
    setSavingConversion(false)
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

  // Student view: their own total per assessment, plus their mark for each
  // component behind it, so the card can explain how the total was made up.
  const [studentMarks, setStudentMarks] = useState<Record<string, AssessmentMark>>({})
  const [studentComponentMarks, setStudentComponentMarks] = useState<Record<string, AssessmentComponentMark>>({})
  // Until the first read lands, each card shows a placeholder score rather
  // than claiming "Marks not yet available".
  const [studentMarksLoaded, setStudentMarksLoaded] = useState(false)
  useEffect(() => {
    if (!isStudent || assessments.length === 0) return
    const ids = assessments.map(a => a.id)
    let cancelled = false
    Promise.all([
      fetchStudentAssessmentMarks(userId, ids),
      fetchStudentComponentMarks(userId, ids),
    ]).then(([byAssessment, byComponent]) => {
      if (cancelled) return
      setStudentMarks(byAssessment)
      setStudentComponentMarks(byComponent)
      setStudentMarksLoaded(true)
    })
    return () => { cancelled = true }
  }, [isStudent, assessments, userId])

  const focusMarkInput = (key: string) => {
    const el = markInputRefs.current[key]
    if (el) { el.focus(); el.select() }
  }

  // Tab/Enter jump straight to the next mark field (in whatever order the
  // sheet is currently sorted) instead of the browser's default tab order,
  // which would otherwise land on the AB toggle button first.
  const handleMarkKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentKey: string,
    order: string[],
  ) => {
    if (e.key !== 'Tab' && e.key !== 'Enter') return
    const idx = order.indexOf(currentKey)
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

  if (loading) return <AssessmentListSkeleton isStaff={isStaff} isStudent={isStudent} />

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 ">
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
            <Plus size={13} /> New assessment
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
              <span className="text-sm font-semibold text-slate-700">New assessment</span>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1 mb-1">
                <Bookmark size={11} /> Report card title
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
                <label htmlFor="new-assessment-max-marks" className="text-xs font-medium text-slate-500 whitespace-nowrap">Max marks</label>
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
        <div className="glass rounded-2xl p-10 text-center">
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
              myMarkLoading={isStudent && !studentMarksLoaded}
              components={componentsByAssessment[assessment.id] ?? []}
              myComponentMarks={studentComponentMarks}
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
          // Square, like a printed sheet: the one popup in Classrooms with straight
          // edges, because the marks grid sits flush inside it.
          <ModalShell
            onClose={requestCloseMarksheet}
            size="2xl"
            sharp
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
              {students.length > 0 && !marksheetLoading && (
                <div className="sticky top-0 z-20 px-2 sm:px-5 py-2 bg-white/90 backdrop-blur-xl flex items-center gap-1 sm:gap-1.5 flex-wrap border-b border-slate-100">
                  <button
                    onClick={() => {
                      if (marksheetSort === 'marks') {
                        setMarksheetSortDir(d => d === 'asc' ? 'desc' : 'asc')
                      } else {
                        setMarksheetSort('marks')
                        setMarksheetSortDir('desc')
                      }
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
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
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
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

                  {/* Components — splits the assessment into named parts that
                      are marked separately and added into one total. */}
                  <button
                    onClick={() => setShowComponentEditor(v => !v)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
 showComponentEditor || components.length > 0
 ? 'bg-indigo-100 text-indigo-700'
 : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
 }`}
                    title="Split this assessment into components"
                  >
                    <SplitSquareHorizontal size={12} />
                    {components.length > 0 ? `${components.length} Components` : 'Components'}
                  </button>

                  {/* Max marks — one value for the whole assessment, editable
                      inline; never overridable per student. Once the
                      assessment is split it is the sum of its parts, so it is
                      changed by re-weighting a component, not typed here. */}
                  <div className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-full text-[11px] font-semibold text-slate-700">
                    {components.length > 0 ? (
                      <span title="Set by the component weights">Max {assessmentMaxMarks}</span>
                    ) : editingMaxMarks ? (
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

                  {/* Total conversion — an optional second maximum the marks
                      are reported at. Blank it out to drop the column. */}
                  <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
 conversionTotal != null ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-700'
 }`}>
                    {editingConversion ? (
                      <>
                        <span className="whitespace-nowrap">Convert to</span>
                        <input
                          type="number"
                          min={1}
                          autoFocus
                          value={conversionDraft}
                          onChange={(e) => setConversionDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSaveConversion() }
                            if (e.key === 'Escape') setEditingConversion(false)
                          }}
                          placeholder="off"
                          className="w-14 border border-slate-300 rounded-md px-1 py-0.5 text-center text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                        />
                        <button
                          onClick={handleSaveConversion}
                          disabled={savingConversion}
                          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
                          title="Save total conversion"
                        >
                          <Check size={13} />
                        </button>
                        <button onClick={() => setEditingConversion(false)} className="text-slate-400 hover:text-slate-600" title="Cancel">
                          <X size={13} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={handleStartEditConversion}
                        className="flex items-center gap-1 hover:opacity-80"
                        title={conversionTotal != null
                          ? `Marks are also reported out of ${conversionTotal} — click to change or clear`
                          : 'Also report these marks out of a different total'}
                      >
                        <Scale size={11} />
                        {conversionTotal != null ? `Convert to ${conversionTotal}` : 'Convert'}
                        <Pencil size={10} />
                      </button>
                    )}
                  </div>

                  <button
                    onClick={handleDownload}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-full text-[11px] font-semibold transition-colors"
                    title="Export marksheet as CSV"
                  >
                    <Download size={13} /> Export
                  </button>

                  {/* Save is repeated here so a long sheet can be saved without
                      scrolling all the way back down. */}
                  <button
                    onClick={() => handleSaveMarks(showMarksheet)}
                    disabled={saving || hasInvalidMarks}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-full text-[11px] font-bold shadow-md shadow-amber-500/25 active:scale-95 transition-all disabled:opacity-60 disabled:shadow-none"
                    title="Save marks"
                  >
                    <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}

              {/* Component editor — the split itself, kept out of the way until
                  asked for. Saving it reshapes the marksheet below. */}
              <AnimatePresence initial={false}>
                {showComponentEditor && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden border-b border-indigo-100 bg-indigo-50/40"
                  >
                    <div className="px-2 sm:px-5 py-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <SplitSquareHorizontal size={14} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-[11px] font-bold text-slate-700">Components</p>
                          <p className="text-[9px] text-slate-500 leading-relaxed">
                            Split this assessment into parts marked separately — e.g. Lab out of 20 and
                            Examination out of 80. The assessment is then scored out of their combined total.
                            Use the <FileInput size={10} className="inline -mt-0.5 text-indigo-500" /> button to
                            fill a part from another marksheet in this classroom instead of marking it again.
                          </p>
                        </div>
                      </div>

                      {componentDrafts.length === 0 ? (
                        <p className="text-[9px] text-slate-500 italic">
                          No components — the assessment is marked as a single score.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {componentDrafts.map((draft, idx) => {
                            const rowMax = parseFloat(draft.maxMarks)
                            const rescaled = draft.imported != null
                              && isFinite(rowMax) && rowMax > 0
                              && rowMax !== draft.imported.sourceMax
                            return (
                            <div key={draft.id ?? `new-${idx}`}>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0 relative">
                                  <input
                                    type="text"
                                    value={draft.name}
                                    onChange={(e) => setComponentDrafts(prev =>
                                      prev.map((d, i) => i === idx ? { ...d, name: e.target.value } : d))}
                                    placeholder="Component name"
                                    className="w-full border border-slate-200 rounded-lg pl-2.5 pr-9 py-1.5 text-[11px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                                  />
                                  {/* Import: fill this component from another
                                      marksheet in the classroom instead of
                                      marking it from scratch. */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setImportPickerRow(importPickerRow === idx ? null : idx)
                                      setImportQuery('')
                                    }}
                                    className={`absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors ${
 importPickerRow === idx || draft.imported
 ? 'bg-indigo-100 text-indigo-600'
 : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
 }`}
                                    title="Import marks from another marksheet in this classroom"
                                  >
                                    <FileInput size={13} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <span className="text-[9px] text-slate-500">out of</span>
                                  <input
                                    type="number"
                                    min={1}
                                    value={draft.maxMarks}
                                    onChange={(e) => setComponentDrafts(prev =>
                                      prev.map((d, i) => i === idx ? { ...d, maxMarks: e.target.value } : d))}
                                    className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] text-center tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setComponentDrafts(prev => prev.filter((_, i) => i !== idx))
                                    setImportPickerRow(null)
                                  }}
                                  className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                                  title={`Remove ${draft.name.trim() || 'this component'}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              {/* What the import will do, said plainly before
                                  it is saved — including the rescaling, which
                                  is the part worth checking. */}
                              {draft.imported && (
                                <div className="mt-1 ml-0.5 flex items-center gap-1.5 flex-wrap text-[9px] text-slate-500">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-semibold">
                                    <FileInput size={9} /> {draft.imported.title}
                                  </span>
                                  <span>
                                    {Object.keys(draft.imported.marks).length} mark
                                    {Object.keys(draft.imported.marks).length === 1 ? '' : 's'} out of {draft.imported.sourceMax}
                                    {rescaled
                                      ? ` — rescaled to fit out of ${rowMax}`
                                      : ' — copied as they are'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setComponentDrafts(prev => prev.map((d, i) =>
                                      i === idx ? { ...d, imported: undefined } : d))}
                                    className="text-slate-400 hover:text-red-500 font-medium underline"
                                  >
                                    Don&apos;t import
                                  </button>
                                </div>
                              )}

                              {/* Type-ahead over the classroom's other marksheets. */}
                              {importPickerRow === idx && (
                                <div className="mt-1.5 rounded-xl border border-indigo-200 bg-white overflow-hidden shadow-sm">
                                  <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-slate-100">
                                    <Search size={12} className="text-slate-400 flex-shrink-0" />
                                    <input
                                      type="text"
                                      autoFocus
                                      value={importQuery}
                                      onChange={(e) => setImportQuery(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Escape') setImportPickerRow(null)
                                        if (e.key === 'Enter' && importCandidates.length > 0) {
                                          e.preventDefault()
                                          handleImportMarksheet(idx, importCandidates[0])
                                        }
                                      }}
                                      placeholder="Search this classroom's marksheets…"
                                      className="flex-1 min-w-0 text-[11px] bg-transparent focus:outline-none text-slate-700 placeholder:text-slate-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setImportPickerRow(null)}
                                      className="text-slate-300 hover:text-slate-500 flex-shrink-0"
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                  {importCandidates.length === 0 ? (
                                    <p className="px-2.5 py-3 text-[9px] text-slate-400 text-center">
                                      {assessments.length <= 1
                                        ? 'This is the only assessment in the classroom.'
                                        : 'No other marksheet matches that.'}
                                    </p>
                                  ) : (
                                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-50">
                                      {importCandidates.map(candidate => (
                                        <button
                                          key={candidate.id}
                                          type="button"
                                          disabled={importingFrom != null}
                                          onClick={() => handleImportMarksheet(idx, candidate)}
                                          className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-indigo-50/60 transition-colors disabled:opacity-50"
                                        >
                                          <div className="min-w-0 flex-1">
                                            <p className="min-w-0 text-[11px] font-semibold text-slate-700 break-words">{candidate.title}</p>
                                            <p className="text-[9px] text-slate-400">
                                              out of {Number(candidate.max_marks)}
                                              {candidate.date ? ` · ${new Date(candidate.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                                              {candidate.report_card_title ? ` · ${candidate.report_card_title}` : ''}
                                            </p>
                                          </div>
                                          {importingFrom === candidate.id
                                            ? <Loader2 size={12} className="text-indigo-500 animate-spin flex-shrink-0" />
                                            : <FileInput size={12} className="text-slate-300 flex-shrink-0" />}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            )
                          })}
                        </div>
                      )}

                      {componentDraftError && (
                        <p className="flex items-center gap-1.5 text-[9px] text-red-600 font-medium">
                          <AlertTriangle size={12} className="flex-shrink-0" /> {componentDraftError}
                        </p>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            setComponentDrafts(prev => [...prev, { name: '', maxMarks: '' }])
                            // Open the picker on the new row: importing is the
                            // faster path whenever the marks already exist.
                            setImportPickerRow(componentDrafts.length)
                            setImportQuery('')
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded-lg text-[11px] font-semibold hover:bg-indigo-50 transition-colors"
                        >
                          <Plus size={12} /> Add component
                        </button>
                        {componentDrafts.length > 0 && (
                          <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
                            Total out of {componentDraftMax}
                          </span>
                        )}
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => {
                            setShowComponentEditor(false)
                            setComponentDrafts(components.map(c => ({ id: c.id, name: c.name, maxMarks: String(c.max_marks) })))
                          }}
                          className="text-[11px] text-slate-600 hover:text-slate-900 px-2"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveComponents}
                          disabled={savingComponents || componentDraftError != null}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50"
                        >
                          <Save size={12} /> {savingComponents ? 'Saving…' : 'Save components'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

                {marksheetLoading ? (
                  <MarksheetSkeleton
                    components={components}
                    maxMarks={assessmentMaxMarks}
                    conversionTotal={conversionTotal}
                    rows={skeletonRowCount(classroom.members.filter(m => m.role === 'student').length, 8, 14)}
                  />
                ) : students.length === 0 ? (
                  <p className="text-[11px] text-slate-500 text-center py-6">No students in this classroom</p>
                ) : (
                  (() => {
                    const split = components.length > 0
                    // What a student currently scores overall, for sorting and
                    // for the row's own total cell.
                    const scoreOf = (studentId: string): number | null => {
                      const m = marks[studentId]
                      if (m?.isAbsent) return null
                      if (split) return componentRowTotal(componentMarks[studentId], components)
                      if (!m || m.marks.trim() === '') return null
                      const n = parseFloat(m.marks)
                      return isNaN(n) ? null : n
                    }

                    const sortedStudents = [...students].sort((a, b) => {
                      if (marksheetSort === 'name') {
                        const cmp = a.user.full_name.localeCompare(b.user.full_name)
                        return marksheetSortDir === 'asc' ? cmp : -cmp
                      }
                      const aScore = scoreOf(a.user_id)
                      const bScore = scoreOf(b.user_id)
                      const aPct = aScore != null ? aScore / assessmentMaxMarks : -1
                      const bPct = bScore != null ? bScore / assessmentMaxMarks : -1
                      return marksheetSortDir === 'asc' ? aPct - bPct : bPct - aPct
                    })
                    // Tab and Enter run down a column before moving across:
                    // a split sheet is marked one component at a time, not one
                    // student at a time.
                    const order = split
                      ? components.flatMap(c => sortedStudents.map(s => `${s.user_id}:${c.id}`))
                      : sortedStudents.map(s => s.user_id)
                    return (
                  <>
                    {hasInvalidMarks && (
                      <div className="mx-2 sm:mx-5 mt-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-100 rounded-lg text-[9px] text-red-600 font-medium">
                        <AlertTriangle size={13} className="flex-shrink-0" /> Some marks are invalid — fix them before saving.
                      </div>
                    )}

                    {/* Dense, excel-like table — small row height so far more
                        students are visible at once without scrolling.
                        Exactly two type sizes throughout: 11px for every
                        figure and name, 9px for every label. Each column says
                        what it is marked out of in its own heading, so no row
                        has to repeat it. */}
                    <div className="overflow-x-auto px-2 sm:px-5 pt-2 pb-1">
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="text-left text-[9px] uppercase tracking-wide text-slate-600 font-bold align-bottom">
                            <th className="hidden sm:table-cell py-1 pr-2 w-7 font-bold">#</th>
                            <th className="py-1 pr-1.5 font-bold">Student</th>
                            {components.map(c => (
                              <th key={c.id} className="py-1 px-1 sm:px-2 text-center w-[58px] sm:w-24 font-bold">
                                <span className="min-w-0 block break-words" title={c.name}>{c.name}</span>
                                <span className="block font-semibold text-slate-400 normal-case tracking-normal">
                                  /{Number(c.max_marks)}
                                </span>
                              </th>
                            ))}
                            <th className={`py-1 px-1 sm:px-2 text-center font-bold ${split ? 'w-[52px] sm:w-20 border-l border-slate-200' : 'w-[62px] sm:w-28'}`}>
                              <span className="block">{split ? 'Total' : 'Marks'}</span>
                              <span className="block font-semibold text-slate-400 normal-case tracking-normal">
                                /{assessmentMaxMarks}
                              </span>
                            </th>
                            {conversionTotal != null && (
                              <th className="py-1 px-1 sm:px-2 text-center w-[54px] sm:w-20 font-bold text-violet-700">
                                <span className="block">Conv.</span>
                                <span className="block font-semibold text-violet-400 normal-case tracking-normal">
                                  /{conversionTotal}
                                </span>
                              </th>
                            )}
                            <th className="py-1 px-1 sm:px-2 text-center w-11 sm:w-14 font-bold">%</th>
                            <th className="py-1 pl-1 sm:pl-2 text-center w-9 sm:w-12 font-bold">AB</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedStudents.map((student, idx) => {
                            const mark = marks[student.user_id] || { marks: '', isAbsent: false }
                            const num = scoreOf(student.user_id)
                            const pct = !mark.isAbsent && num != null
                              ? Math.round((num / assessmentMaxMarks) * 100) : null
                            const converted = conversionTotal != null && !mark.isAbsent
                              ? rescaleMark(num, assessmentMaxMarks, conversionTotal) : null
                            const error = !mark.isAbsent && !split ? getMarkError(mark.marks) : null
                            return (
                              <tr
                                key={student.user_id}
                                className={`border-b border-slate-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-amber-50/40`}
                              >
                                <td className="hidden sm:table-cell py-1 pr-2 text-slate-500 tabular-nums align-middle">{idx + 1}</td>
                                <td className="py-1 pr-1.5 align-middle">
                                  {/* A fixed width from the inside: a table
                                      cell ignores max-width, so without it the
                                      longest name decides how little room the
                                      marks get on a phone. */}
                                  <div className="w-[104px] sm:w-auto flex items-center gap-1.5 sm:gap-2 min-w-0">
                                    <span className="hidden sm:inline-flex">
                                      <Avatar avatarUrl={student.user.avatar_url} name={student.user.full_name} size={22} userId={student.user_id} />
                                    </span>
                                    <span className="sm:hidden text-slate-400 tabular-nums w-3.5 flex-shrink-0 text-[9px]">{idx + 1}</span>
                                    <span className="min-w-0 break-words font-medium text-slate-700">{student.user.full_name}</span>
                                  </div>
                                </td>

                                {/* One cell per component; each is marked out of
                                    its own maximum. */}
                                {components.map(c => {
                                  const cellKey = `${student.user_id}:${c.id}`
                                  const raw = componentMarks[student.user_id]?.[c.id] ?? ''
                                  const cellError = mark.isAbsent ? null : markError(raw, Number(c.max_marks))
                                  return (
                                    <td key={c.id} className="py-1 px-1 sm:px-2 align-middle">
                                      <div className="flex items-center justify-center">
                                        <input
                                          ref={(el) => { markInputRefs.current[cellKey] = el }}
                                          type="number"
                                          min={0}
                                          max={Number(c.max_marks)}
                                          value={mark.isAbsent ? '' : raw}
                                          disabled={mark.isAbsent}
                                          onChange={(e) => setComponentMarks(prev => ({
                                            ...prev,
                                            [student.user_id]: {
                                              ...(prev[student.user_id] ?? {}),
                                              [c.id]: e.target.value,
                                            },
                                          }))}
                                          onKeyDown={(e) => handleMarkKeyDown(e, cellKey, order)}
                                          placeholder={mark.isAbsent ? 'AB' : '—'}
                                          title={cellError ?? `${c.name} — out of ${Number(c.max_marks)}`}
                                          className={`w-[52px] sm:w-14 border rounded-md sm:rounded-lg px-1 py-1 text-center tabular-nums focus:outline-none focus:ring-2 transition-colors disabled:bg-slate-100 disabled:text-slate-400 disabled:placeholder:text-slate-400 ${
 cellError
 ? 'border-red-300 focus:ring-red-400/50 bg-red-50/60'
 : 'border-slate-200 focus:ring-amber-400/50'
 }`}
                                        />
                                      </div>
                                    </td>
                                  )
                                })}

                                <td className={`py-1 px-1 sm:px-2 align-middle ${split ? 'border-l border-slate-200' : ''}`}>
                                  {split ? (
                                    // Derived, never typed: the total is the sum
                                    // of the components above it.
                                    <div className="text-center tabular-nums">
                                      {mark.isAbsent ? (
                                        <span className="text-slate-400">AB</span>
                                      ) : num != null ? (
                                        <span className="font-bold text-slate-800">{num}</span>
                                      ) : (
                                        <span className="text-slate-400">—</span>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center">
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
                                        className={`w-[52px] sm:w-14 border rounded-md sm:rounded-lg px-1 py-1 text-center tabular-nums focus:outline-none focus:ring-2 transition-colors disabled:bg-slate-100 disabled:text-slate-400 disabled:placeholder:text-slate-400 ${
 error
 ? 'border-red-300 focus:ring-red-400/50 bg-red-50/60'
 : 'border-slate-200 focus:ring-amber-400/50'
 }`}
                                      />
                                    </div>
                                  )}
                                </td>
                                {conversionTotal != null && (
                                  // Derived on read from the total — nothing is
                                  // ever stored at the converted scale.
                                  <td className="py-1 px-1 sm:px-2 text-center align-middle tabular-nums">
                                    {mark.isAbsent ? (
                                      <span className="text-slate-400">AB</span>
                                    ) : converted != null ? (
                                      <span className="font-bold text-violet-700">{converted}</span>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                )}
                                <td className="py-1 px-1 sm:px-2 text-center align-middle">
                                  {mark.isAbsent ? (
                                    <span className="text-[9px] px-1 py-0.5 rounded-full font-bold bg-slate-200 text-slate-500">AB</span>
                                  ) : pct != null ? (
                                    <span className={`text-[9px] px-1 py-0.5 rounded-full font-bold ${
 pct >= 80 ? 'bg-green-100 text-green-700' :
 pct >= 60 ? 'bg-amber-100 text-amber-700' :
 'bg-red-100 text-red-700'
 }`}>{pct}</span>
                                  ) : <span className="text-slate-400">—</span>}
                                </td>
                                <td className="py-1 pl-1 sm:pl-2 text-center align-middle">
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    onClick={() => {
                                      // Absent is a fact about the assessment,
                                      // not about one component, so it clears
                                      // every cell in the row.
                                      setMarks((prev) => ({
                                        ...prev,
                                        [student.user_id]: { marks: '', isAbsent: !mark.isAbsent },
                                      }))
                                      if (split) {
                                        setComponentMarks(prev => ({
                                          ...prev,
                                          [student.user_id]: Object.fromEntries(components.map(c => [c.id, ''])),
                                        }))
                                      }
                                    }}
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

                    <div className="px-2 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
                      <button
                        onClick={() => handleSaveMarks(showMarksheet)}
                        disabled={saving || hasInvalidMarks}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[11px] font-bold shadow-lg shadow-amber-500/25 active:scale-[0.99] transition-all disabled:opacity-60 disabled:shadow-none"
                      >
                        <Save size={15} /> {saving ? 'Saving...' : 'Save marks'}
                      </button>
                    </div>
                  </>
                    )
                  })()
                )}
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Unsaved marks on the way out */}
      <AnimatePresence>
        {confirmingClose && showMarksheet && (
          <ModalShell
            onClose={() => setConfirmingClose(false)}
            size="sm"
            title="Save your marks?"
            subtitle="This marksheet has changes that have not been saved."
            icon={<AlertTriangle size={16} />}
            iconClassName="bg-amber-100 text-amber-600"
            zClass="z-[70]"
          >
            <div className="space-y-2.5">
              {hasInvalidMarks && (
                <p className="flex items-start gap-1.5 text-xs text-red-600 font-medium">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  Some marks are invalid, so they cannot be saved yet. Go back and fix them, or
                  close without saving.
                </p>
              )}
              <button
                onClick={() => handleSaveMarks(showMarksheet)}
                disabled={saving || hasInvalidMarks}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <Save size={14} /> {saving ? 'Saving…' : 'Save and close'}
              </button>
              <button
                onClick={discardAndClose}
                className="w-full py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold transition-colors"
              >
                Close without saving
              </button>
              <button
                onClick={() => setConfirmingClose(false)}
                className="w-full py-2 text-slate-500 hover:text-slate-800 text-sm font-medium"
              >
                Keep editing
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Marksheet skeleton ───────────────────────────────────────────────────────

const MARKSHEET_NAME_WIDTHS = ['w-24', 'w-16', 'w-20', 'w-28', 'w-14', 'w-24', 'w-20']

/** The marksheet while its students and marks load: the toolbar's pills, then
 *  the sheet's real column headings — the split, the maximum and the
 *  conversion are all known before the fetch — over placeholder rows of the
 *  same height as the mark inputs that replace them. */
function MarksheetSkeleton({ components, maxMarks, conversionTotal, rows }: {
  components: AssessmentComponent[]
  maxMarks: number
  conversionTotal: number | null
  rows: number
}) {
  const split = components.length > 0
  const inputCell = (delay: number) => (
    <div className="flex items-center justify-center">
      <Sk className="w-[52px] sm:w-14 h-[26px] rounded-md sm:rounded-lg" delay={delay} />
    </div>
  )
  return (
    <SkeletonRegion label="Loading marksheet…">
      {/* Toolbar: sort, components, max, convert … export, save */}
      <div className="px-2 sm:px-5 py-2 flex items-center gap-1 sm:gap-1.5 flex-wrap border-b border-slate-100">
        {['w-[70px]', 'w-[66px]', 'w-[104px]', 'w-[68px]', 'w-[86px]'].map((w, i) => (
          <Sk key={i} className={`h-7 ${w} rounded-full`} delay={i * 60} />
        ))}
        <Sk className="ml-auto h-7 w-[78px] rounded-full" delay={300} />
        <Sk className="h-7 w-[66px] rounded-full" delay={360} />
      </div>

      <div className="overflow-x-auto px-2 sm:px-5 pt-2 pb-1">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wide text-slate-600 font-bold align-bottom">
              <th className="hidden sm:table-cell py-1 pr-2 w-7 font-bold">#</th>
              <th className="py-1 pr-1.5 font-bold">Student</th>
              {components.map(c => (
                <th key={c.id} className="py-1 px-1 sm:px-2 text-center w-[58px] sm:w-24 font-bold">
                  <span className="min-w-0 block break-words">{c.name}</span>
                  <span className="block font-semibold text-slate-400 normal-case tracking-normal">/{Number(c.max_marks)}</span>
                </th>
              ))}
              <th className={`py-1 px-1 sm:px-2 text-center font-bold ${split ? 'w-[52px] sm:w-20 border-l border-slate-200' : 'w-[62px] sm:w-28'}`}>
                <span className="block">{split ? 'Total' : 'Marks'}</span>
                <span className="block font-semibold text-slate-400 normal-case tracking-normal">/{maxMarks}</span>
              </th>
              {conversionTotal != null && (
                <th className="py-1 px-1 sm:px-2 text-center w-[54px] sm:w-20 font-bold text-violet-700">
                  <span className="block">Conv.</span>
                  <span className="block font-semibold text-violet-400 normal-case tracking-normal">/{conversionTotal}</span>
                </th>
              )}
              <th className="py-1 px-1 sm:px-2 text-center w-11 sm:w-14 font-bold">%</th>
              <th className="py-1 pl-1 sm:pl-2 text-center w-9 sm:w-12 font-bold">AB</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, idx) => {
              const d = idx * 50
              return (
                <tr key={idx} className={`border-b border-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                  <td className="hidden sm:table-cell py-1 pr-2 align-middle">
                    <Sk className="h-2 w-3 !rounded-full" delay={d} />
                  </td>
                  <td className="py-1 pr-1.5 align-middle">
                    <div className="w-[104px] sm:w-auto flex items-center gap-1.5 sm:gap-2 min-w-0">
                      <span className="hidden sm:inline-flex"><SkAvatar size={22} delay={d} /></span>
                      <SkText line="h-[26px]" className={MARKSHEET_NAME_WIDTHS[idx % MARKSHEET_NAME_WIDTHS.length]} delay={d + 30} />
                    </div>
                  </td>
                  {components.map((c, ci) => (
                    <td key={c.id} className="py-1 px-1 sm:px-2 align-middle">{inputCell(d + 60 + ci * 30)}</td>
                  ))}
                  <td className={`py-1 px-1 sm:px-2 align-middle ${split ? 'border-l border-slate-200' : ''}`}>
                    {split
                      ? <div className="flex justify-center"><Sk className="h-2.5 w-5 !rounded-full" delay={d + 90} /></div>
                      : inputCell(d + 60)}
                  </td>
                  {conversionTotal != null && (
                    <td className="py-1 px-1 sm:px-2 align-middle">
                      <div className="flex justify-center"><Sk className="h-2.5 w-5 !rounded-full" delay={d + 120} /></div>
                    </td>
                  )}
                  <td className="py-1 px-1 sm:px-2 align-middle">
                    <div className="flex justify-center"><Sk className="h-[17px] w-7 rounded-full" delay={d + 150} /></div>
                  </td>
                  <td className="py-1 pl-1 sm:pl-2 align-middle">
                    <div className="flex justify-center"><Sk className="w-[21px] h-[21px] rounded-lg" delay={d + 180} /></div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-2 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <Sk className="h-9 w-full rounded-xl" delay={200} />
      </div>
    </SkeletonRegion>
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
  /** True while the student's own marks are still being read. */
  myMarkLoading: boolean
  /** The assessment's components, empty when it is marked as a single score. */
  components: AssessmentComponent[]
  /** This student's component marks, keyed by component id. */
  myComponentMarks: Record<string, AssessmentComponentMark>
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
  assessment, isStudent, isStaff, userId, creatorName, myMark, myMarkLoading, components, myComponentMarks,
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

  const convertedMark = assessment.conversion_total != null && myMark && !myMark.is_absent
    ? rescaleMark(myMark.marks, Number(myMark.max_marks), Number(assessment.conversion_total))
    : null

  return (
    <div
      className={`bg-white border rounded-2xl border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,.05),0_10px_24px_-18px_rgba(15,23,42,.4)] transition-all ${
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
              {components.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-semibold"
                  title={components.map(c => `${c.name} ${Number(c.max_marks)}`).join(' · ')}
                >
                  <SplitSquareHorizontal size={9} />
                  {components.map(c => `${c.name} ${Number(c.max_marks)}`).join(' + ')}
                </span>
              )}
              {assessment.conversion_total != null && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full font-semibold"
                  title={`Also reported out of ${assessment.conversion_total}`}
                >
                  <Scale size={9} /> → {Number(assessment.conversion_total)}
                </span>
              )}
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

            {/* Student: marks display. A split assessment shows the parts it
                was made of alongside the total, so the score is explained
                rather than just stated. */}
            {isStudent && myMark && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-baseline gap-1 px-3 py-1.5 bg-white rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold mr-1">
                      {components.length > 0 ? 'Total' : 'Score'}
                    </span>
                    <span className="text-lg font-bold text-slate-800">{myMark.is_absent ? 'AB' : myMark.marks ?? '—'}</span>
                    {!myMark.is_absent && <span className="text-xs text-slate-500">/ {myMark.max_marks}</span>}
                  </div>
                  {/* Where the school reports these marks at another scale,
                      the student sees that figure alongside the raw one. */}
                  {convertedMark != null && (
                    <div className="flex items-baseline gap-1 px-3 py-1.5 bg-violet-50 rounded-xl border border-violet-200">
                      <span className="text-[9px] uppercase tracking-widest text-violet-400 font-semibold mr-1">Converted</span>
                      <span className="text-lg font-bold text-violet-700">{convertedMark}</span>
                      <span className="text-xs text-violet-400">/ {assessment.conversion_total}</span>
                    </div>
                  )}
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

                {components.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
                      Breakdown
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {components.map(c => {
                        const cm = myComponentMarks[c.id]
                        const cMax = Number(c.max_marks)
                        const cPct = cm && !cm.is_absent && cm.marks != null && cMax > 0
                          ? Math.round((Number(cm.marks) / cMax) * 100)
                          : null
                        return (
                          <div
                            key={c.id}
                            className="flex items-baseline gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg"
                          >
                            <span className="text-[11px] font-semibold text-slate-600">{c.name}</span>
                            <span className="text-xs font-bold text-slate-800 tabular-nums">
                              {cm?.is_absent
                                ? <span className="text-red-500">AB</span>
                                : cm && cm.marks != null
                                  ? <>{Number(cm.marks)}<span className="font-normal text-slate-400">/{cMax}</span></>
                                  : <span className="font-normal text-slate-400">—/{cMax}</span>}
                            </span>
                            {cPct != null && (
                              <span className="text-[10px] font-semibold text-slate-400 tabular-nums">{cPct}%</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {isStudent && !myMark && myMarkLoading && <ScoreBlockSkeleton />}
            {isStudent && !myMark && !myMarkLoading && (
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
                  <Bookmark size={10} /> Report card title
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
                  <label htmlFor={`edit-max-marks-${assessment.id}`} className="text-xs font-medium text-slate-500 whitespace-nowrap">Max marks</label>
                  <input
                    id={`edit-max-marks-${assessment.id}`}
                    type="number"
                    min={1}
                    value={editMaxMarks}
                    onChange={(e) => onEditMaxMarksChange(e.target.value)}
                    // A split assessment is marked out of the sum of its
                    // components, so the total is re-weighted there, not here.
                    disabled={components.length > 0}
                    title={components.length > 0 ? 'Set by the component weights — edit them in the marksheet' : undefined}
                    className="w-20 border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400/50 disabled:bg-slate-100 disabled:text-slate-400"
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
