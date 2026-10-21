'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import Link from 'next/link'
import PageBanner from '@/components/PageBanner'
import PageToolbar, { ListSentinel } from '@/components/PageToolbar'
import ModalShell from '@/components/ui/ModalShell'
import { askConfirm, SheetFooter, SheetLabel, SHEET_BTN_PRIMARY, SHEET_INPUT } from '@/components/ui/sheet'
import UserEmailSuggest from '@/components/UserEmailSuggest'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { BookOpen, Plus, X, UserMinus, ChevronDown, ChevronUp, Edit3, Save, Loader2, Users, Lock, LockOpen, Trash2, ExternalLink, Search, Tag, Home, MonitorPlay, Info, DownloadCloud, CheckCircle2 } from 'lucide-react'
import SubjectPicker from '@/components/classrooms/SubjectPicker'
import { Homeroom, searchHomerooms } from '@/lib/homerooms'
import { importHomeroomIntoClassroom, fetchSmartboardAccounts, addSmartboardToClassroom, fetchSmartboardIdsForGradeSection } from '@/lib/smartboard'
import { fetchClassTeachersForGradeSection } from '@/lib/homeroomClassTeachers'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
import { CLASSROOMS_BANNER_DEFAULT } from '@/lib/pageConfig'
import { ClassroomMember, ClassroomMemberRole, ClassroomWithDetails, fetchClassroomManagerPage, createClassroom, updateClassroom, fetchClassroomById, addMemberByEmail, removeClassroomMember, deleteClassroom, isClassroomClosed } from '@/lib/classrooms'
import { supabase } from '@/lib/supabase'
import { useServerPagedList } from '@/hooks/useServerPagedList'
import useDebounce from '@/hooks/useDebounce'

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.03 } },
}

const itemVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
}

/** The academic years a classroom can be set in, "2020-21" onwards. */
const ACADEMIC_YEARS = Array.from({ length: 21 }, (_, i) => { const y = 2020 + i; return `${y}-${String(y + 1).slice(-2)}` })

export default function ClassroomManagerPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const router = useRouter()

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [expandedClassroom, setExpandedClassroom] = useState<string | null>(null)
  const [bannerEditing, setBannerEditing] = useState(false)
  const [expandedDetails, setExpandedDetails] = useState<ClassroomWithDetails | null>(null)

  const [newClassroom, setNewClassroom] = useState({
    title: '', description: '', grade: '', section: '', subject: '',
    academic_year: '', coordinator_email: '', teacher_email: '',
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [editingClassroom, setEditingClassroom] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', academic_year: '', grade: '', section: '', subject: '' })
  const [saving, setSaving] = useState(false)

  const [addMemberEmailInput, setAddMemberEmailInput] = useState('')
  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [memberError, setMemberError] = useState('')

  const [classroomSearch, setClassroomSearch] = useState('')

  const closeCreate = () => { setShowCreateForm(false); setCreateError('') }

  function academicYearToDates(ay: string): { start_date: string | null; end_date: string | null } {
    const match = ay.match(/^(\d{4})-(\d{2,4})$/)
    if (!match) return { start_date: null, end_date: null }
    const startYear = parseInt(match[1])
    return { start_date: `${startYear}-04-01`, end_date: `${startYear + 1}-03-31` }
  }

  function datesToAcademicYear(start_date: string | null): string {
    if (!start_date) return ''
    const y = parseInt(start_date.split('-')[0])
    return `${y}-${String(y + 1).slice(-2)}`
  }

  // The roster of classrooms is read a page at a time, searched and ordered
  // and counted by Postgres. Typing is debounced so a search is one query when
  // the admin stops, not one per keystroke.
  const debouncedSearch = useDebounce(classroomSearch, 250)
  const [bandTotals, setBandTotals] = useState({ active: 0, closed: 0 })

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const page = await fetchClassroomManagerPage(debouncedSearch, offset, limit)
    setBandTotals({ active: page.activeTotal, closed: page.closedTotal })
    return { rows: page.rows, total: page.total }
  }, [debouncedSearch])

  const list = useServerPagedList(fetchPage, { resetKey: debouncedSearch.trim().toLowerCase() })
  const { rows: visibleRows, total, loading } = list
  const loadClassrooms = list.reload

  const loadClassroomDetails = async (classroomId: string) => {
    const details = await fetchClassroomById(classroomId)
    if (details) setExpandedDetails(details)
  }

  const handleToggleClose = async (classroom: ClassroomWithDetails) => {
    const closing = !isClassroomClosed(classroom)
    if (!(await askConfirm(closing
      ? { title: 'Close this classroom?', body: `“${classroom.title}” becomes read-only for everyone. You can reopen it later.`, confirmLabel: 'Close classroom' }
      : { title: 'Reopen this classroom?', body: `“${classroom.title}” runs again until the end of its academic year.`, confirmLabel: 'Reopen' }))) return
    if (!closing) {
      const reopenEnd = classroom.start_date
        ? `${parseInt(classroom.start_date.split('-')[0]) + 1}-03-31` : null
      await updateClassroom(classroom.id, { end_date: reopenEnd })
    } else {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      await updateClassroom(classroom.id, { end_date: yesterday.toISOString().split('T')[0] })
    }
    await loadClassrooms()
  }

  const handleExpand = async (classroomId: string) => {
    if (expandedClassroom === classroomId) {
      setExpandedClassroom(null); setExpandedDetails(null)
    } else {
      setExpandedClassroom(classroomId)
      await loadClassroomDetails(classroomId)
    }
  }

  const handleStartEdit = (classroom: ClassroomWithDetails) => {
    setEditingClassroom(classroom.id)
    setEditForm({
      title: classroom.title,
      description: classroom.description || '',
      academic_year: datesToAcademicYear(classroom.start_date),
      grade: classroom.grade != null ? String(classroom.grade) : '',
      section: classroom.section || '',
      subject: classroom.subject || '',
    })
  }

  const handleSaveEdit = async (classroomId: string) => {
    if (!editForm.title.trim()) return
    setSaving(true)
    const { start_date, end_date } = academicYearToDates(editForm.academic_year)
    const ok = await updateClassroom(classroomId, {
      title: editForm.title.trim(),
      description: editForm.description.trim() || null,
      grade: editForm.grade ? parseInt(editForm.grade) : null,
      section: editForm.section.trim() || null,
      subject: editForm.subject.trim() || null,
      start_date, end_date,
    })
    if (ok) {
      setEditingClassroom(null)
      await loadClassrooms()
      if (expandedClassroom === classroomId) await loadClassroomDetails(classroomId)
    }
    setSaving(false)
  }

  const handleCreateClassroom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newClassroom.title.trim() || !user || !profile) return
    if (!newClassroom.academic_year) { setCreateError('Academic year is required'); return }
    setCreateError('')
    setCreating(true)

    let coordinatorId: string | undefined
    if (newClassroom.coordinator_email.trim()) {
      const { data: coordProfile } = await supabase
        .from('profiles').select('id, role')
        .eq('email', newClassroom.coordinator_email.trim().toLowerCase())
        .in('role', ['coordinator', 'principal', 'admin']).single()
      if (coordProfile) {
        coordinatorId = coordProfile.id
      } else {
        setCreating(false)
        setCreateError('No coordinator, principal or admin has that email.')
        return
      }
    }

    const { start_date: ayStart, end_date: ayEnd } = academicYearToDates(newClassroom.academic_year)
    const result = await createClassroom({
      title: newClassroom.title.trim(),
      description: newClassroom.description.trim() || undefined,
      grade: newClassroom.grade ? parseInt(newClassroom.grade) : null,
      section: newClassroom.section.trim() || null,
      subject: newClassroom.subject.trim() || null,
      start_date: ayStart || undefined,
      end_date: ayEnd || undefined,
      coordinator_id: coordinatorId,
      creatorRole: profile.role,
    }, user.id)

    if (result) {
      const gradeNum = newClassroom.grade ? parseInt(newClassroom.grade) : null
      const section  = newClassroom.section.trim().toUpperCase()

      // Every roster lookup is independent of the others, so they go together
      // rather than the smart board query waiting behind two inserts.
      const [defaultRes, studentsRes, boardIds, classTeachers] = await Promise.all([
        supabase.from('profiles').select('id, role').in('role', ['principal', 'admin']),
        gradeNum && section
          ? supabase.from('profiles').select('id').eq('role', 'student').eq('grade', gradeNum).eq('section', section)
          : Promise.resolve({ data: [] as { id: string }[] }),
        gradeNum && section
          ? fetchSmartboardIdsForGradeSection(gradeNum, section)
          : Promise.resolve([] as string[]),
        gradeNum && section
          ? fetchClassTeachersForGradeSection(gradeNum, section)
          : Promise.resolve([] as { id: string; role: ClassroomMemberRole }[]),
      ])
      if (newClassroom.teacher_email.trim()) {
        await addMemberByEmail(result.id, newClassroom.teacher_email.trim())
      }

      // One insert for the whole starting roster — admins/principals, the
      // grade+section's students, its smart board(s), and the class teacher(s)
      // of its homeroom(s) — instead of four.
      // (classroom_members is UNIQUE (classroom_id, user_id), and a duplicate
      // *within* a single statement fails the whole insert rather than just
      // that row, so the same id appearing in two of these lists is dropped
      // here. First writer wins, which keeps the admin/principal role over the
      // teacher-level access a smart board would otherwise be given.)
      const memberRows = new Map<string, { classroom_id: string; user_id: string; role: string }>()
      const addRow = (id: string, role: string) => {
        if (id === user.id || id === coordinatorId || memberRows.has(id)) return
        memberRows.set(id, { classroom_id: result.id, user_id: id, role })
      }
      for (const m of (defaultRes.data ?? []) as { id: string; role: string }[]) addRow(m.id, m.role)
      for (const s of (studentsRes.data ?? []) as { id: string }[]) addRow(s.id, 'student')
      for (const id of boardIds) addRow(id, 'teacher')
      // A homeroom's class teacher comes with the homeroom, at their own staff
      // role — never as a student, so they stay out of rosters and mark sheets.
      for (const t of classTeachers) addRow(t.id, t.role)

      if (memberRows.size > 0) {
        const { error } = await supabase.from('classroom_members').insert([...memberRows.values()])
        if (error && error.code !== '23505') console.error('Failed to add starting roster:', error.message)
      }

      setNewClassroom({ title: '', description: '', grade: '', section: '', subject: '', academic_year: '', coordinator_email: '', teacher_email: '' })
      setShowCreateForm(false)
      await loadClassrooms()
    }
    setCreating(false)
  }

  const handleAddMember = async (classroomId: string) => {
    if (!addMemberEmailInput.trim()) return
    setAddingMember(classroomId); setMemberError('')
    const result = await addMemberByEmail(classroomId, addMemberEmailInput.trim())
    if (result.success) {
      setAddMemberEmailInput('')
      await loadClassroomDetails(classroomId)
    } else {
      setMemberError(result.error || 'Failed to add member')
    }
    setAddingMember(null)
  }

  const handleRemoveMember = async (classroomId: string, userId: string) => {
    await removeClassroomMember(classroomId, userId)
    await loadClassroomDetails(classroomId)
  }

  const handleDeleteClassroom = async (classroomId: string, title: string) => {
    if (!(await askConfirm({
      title: 'Delete this classroom?',
      body: `“${title}” and everything in it (content, homework, assessments and marks) is deleted for good.`,
      danger: true,
    }))) return
    const ok = await deleteClassroom(classroomId)
    if (ok) {
      if (expandedClassroom === classroomId) { setExpandedClassroom(null); setExpandedDetails(null) }
      await loadClassrooms()
    }
  }

  if (!user || !profile) return null

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="classrooms" style={{ minHeight: '100vh' }}>
        <PageBanner
          settingKey="classrooms_banner"
          defaultBanner={CLASSROOMS_BANNER_DEFAULT}
          icon={<BookOpen size={26} className="text-white" />}
          title="Classrooms"
          subtitle={!loading && total > 0
            ? `${bandTotals.active} active · ${bandTotals.closed} closed`
            : 'Create and manage classrooms'}
          isAdmin={isAdmin}
          onEditingChange={setBannerEditing}
          onBack={() => router.back()}
          maxWidth="max-w-7xl"
          actions={isAdmin ? (
            <>
              <button
                onClick={() => setShowCreateForm(true)}
                className="hidden sm:flex items-center gap-2 h-10 px-4 bg-[#27272A] hover:bg-[#18181B] border-b-2 border-[#B8983C] transition-colors text-white text-sm font-semibold"
              >
                <Plus size={15} />
                New classroom
              </button>
              <button
                onClick={() => setShowCreateForm(true)}
                aria-label="New classroom"
                className="sm:hidden w-10 h-10 bg-[#27272A] hover:bg-[#18181B] border-b-2 border-[#B8983C] transition-colors flex items-center justify-center text-white"
              >
                <Plus size={18} />
              </button>
            </>
          ) : undefined}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10" style={{ opacity: bannerEditing ? 0.35 : 1, pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease' }}>

          <PageToolbar
            search={classroomSearch}
            onSearchChange={setClassroomSearch}
            searchPlaceholder="Search classrooms"
            summary={!loading && total > 0
              ? `${visibleRows.length} of ${total} loaded · ${bandTotals.active} active · ${bandTotals.closed} closed`
              : undefined}
          />

          {/* List */}
          {loading ? (
            <div className="bg-white border border-[#E4E4E7] shadow-[0_1px_2px_rgba(24,24,27,.04),0_14px_30px_-24px_rgba(24,24,27,.35)] py-16 text-center">
              <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A1A1AA]" />
              <p className="text-sm text-[#71717A]">Loading classrooms…</p>
            </div>
          ) : total === 0 && !debouncedSearch ? (
            <div className="bg-white border border-[#E4E4E7] shadow-[0_1px_2px_rgba(24,24,27,.04),0_14px_30px_-24px_rgba(24,24,27,.35)] p-12 text-center">
              <BookOpen size={36} className="text-[#D4D4D8] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#18181B] mb-1">No classrooms yet</p>
              <p className="text-sm text-[#71717A] mb-5">Create your first classroom to get started.</p>
              {isAdmin && (
                <button onClick={() => setShowCreateForm(true)} className="flex items-center gap-2 h-10 px-5 bg-[#27272A] hover:bg-[#18181B] border-b-2 border-[#B8983C] transition-colors text-white text-sm font-semibold mx-auto">
                  <Plus size={14} /> New classroom
                </button>
              )}
            </div>
          ) : total === 0 ? (
            <div className="bg-white border border-[#E4E4E7] shadow-[0_1px_2px_rgba(24,24,27,.04),0_14px_30px_-24px_rgba(24,24,27,.35)] p-10 text-center">
              <p className="text-sm text-[#71717A]">No classrooms match &ldquo;{classroomSearch}&rdquo;</p>
            </div>
          ) : (
            <div className="bg-white border border-[#E4E4E7] shadow-[0_1px_2px_rgba(24,24,27,.04),0_14px_30px_-24px_rgba(24,24,27,.35)] overflow-hidden">
              {/* Column headers */}
              <div className="bg-[#27272A] px-3 py-1.5 hidden sm:flex items-center gap-3 text-[11.5px] font-semibold text-[#C9C9CF]">
                <span className="w-2 flex-shrink-0" aria-hidden />
                <span className="flex-1">Classroom</span>
                <span className="w-32 flex-shrink-0">Subject</span>
                <span className="w-16 flex-shrink-0">Year</span>
                <span className="w-20 flex-shrink-0">Members</span>
                <span className="w-32 text-right flex-shrink-0">Actions</span>
              </div>

              {/* One sequence — active rows, then closed ones, with the band
                  headers drawn wherever the run changes. */}
              <motion.div variants={containerVariants} initial="hidden" animate="show">
                {visibleRows.map(({ classroom, closed }, i) => (
                  <React.Fragment key={classroom.id}>
                    {(i === 0 || visibleRows[i - 1].closed !== closed) && (closed || bandTotals.closed > 0) && (
                      <div className="bg-[#27272A]/90 px-4 py-1.5 flex items-center gap-2 border-t border-[#27272A]">
                        <span className="text-[11.5px] font-semibold text-[#C9C9CF]">{closed ? 'Closed' : 'Active'}</span>
                        <span className="text-[10px] text-[#A1A1AA]/60 font-medium">{closed ? bandTotals.closed : bandTotals.active}</span>
                      </div>
                    )}
                    <ClassroomRow
                      classroom={classroom} closed={closed} isAdmin={isAdmin}
                      expanded={expandedClassroom === classroom.id}
                      expandedDetails={expandedClassroom === classroom.id ? expandedDetails : null}
                      addMemberEmailInput={addMemberEmailInput} addingMember={addingMember} memberError={memberError}
                      onExpand={() => handleExpand(classroom.id)}
                      onStartEdit={() => handleStartEdit(classroom)}
                      onAddMemberEmailChange={v => { setAddMemberEmailInput(v); setMemberError('') }}
                      onAddMember={() => handleAddMember(classroom.id)}
                      onRemoveMember={uid => handleRemoveMember(classroom.id, uid)}
                      onDelete={() => handleDeleteClassroom(classroom.id, classroom.title)}
                      onToggleClose={() => handleToggleClose(classroom)}
                      onImported={() => loadClassroomDetails(classroom.id)}
                    />
                  </React.Fragment>
                ))}
              </motion.div>

              <ListSentinel
                sentinelRef={list.sentinelRef} hasMore={list.hasMore} loadingMore={list.loadingMore}
                shown={visibleRows.length} total={total} onLoadMore={list.loadMore} noun="classrooms"
              />
            </div>
          )}
        </div>
      </div>


      {/* New classroom */}
      <AnimatePresence>
        {showCreateForm && (
          <ModalShell
            key="classroom-create"
            onClose={closeCreate}
            size="lg"
            title="New classroom"
            subtitle="Students of the grade and section join on their own"
            icon={<BookOpen size={16} />}
            iconClassName="text-white [background:linear-gradient(135deg,#3D3B40,#8B6F47)]"
            footer={
              <SheetFooter onCancel={closeCreate}>
                <button type="submit" form="classroom-create-form" disabled={creating || !newClassroom.title.trim()} className={SHEET_BTN_PRIMARY}>
                  {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                  Create classroom
                </button>
              </SheetFooter>
            }
          >
            <form id="classroom-create-form" onSubmit={handleCreateClassroom} className="space-y-3.5">
              <div>
                <SheetLabel htmlFor="nc-title">Title</SheetLabel>
                <input id="nc-title" type="text" value={newClassroom.title} onChange={e => setNewClassroom({ ...newClassroom, title: e.target.value })} className={SHEET_INPUT} placeholder="Class 10 A Science" required autoFocus />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <SheetLabel htmlFor="nc-grade">Grade</SheetLabel>
                  <input id="nc-grade" type="number" inputMode="numeric" value={newClassroom.grade} onChange={e => setNewClassroom({ ...newClassroom, grade: e.target.value })} className={SHEET_INPUT} placeholder="10" min="1" max="12" />
                </div>
                <div>
                  <SheetLabel htmlFor="nc-section">Section</SheetLabel>
                  <input id="nc-section" type="text" value={newClassroom.section} onChange={e => setNewClassroom({ ...newClassroom, section: e.target.value })} className={SHEET_INPUT} placeholder="A" maxLength={5} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <SheetLabel htmlFor="nc-year">Academic year</SheetLabel>
                  <select id="nc-year" value={newClassroom.academic_year} onChange={e => { setNewClassroom({ ...newClassroom, academic_year: e.target.value }); setCreateError('') }} className={SHEET_INPUT} required>
                    <option value="">Choose…</option>
                    {ACADEMIC_YEARS.map(ay => <option key={ay} value={ay}>{ay}</option>)}
                  </select>
                </div>
              </div>
              {/* What a grade + section pulls in on its own, so a roster that
                  arrives pre-filled is never a surprise. */}
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-600 bg-slate-50 rounded-xl px-3 py-2">
                <Info size={13} className="flex-shrink-0 mt-0.5 text-slate-400" />
                <span>
                  {newClassroom.grade && newClassroom.section.trim() ? (
                    <>Every homeroom for <strong>Grade {newClassroom.grade} {newClassroom.section.trim().toUpperCase()}</strong> joins: its students, its smart board and its class teacher.</>
                  ) : (
                    <>With a grade and section set, every matching homeroom joins: students, smart board and class teacher.</>
                  )}
                </span>
              </p>
              <div>
                <SheetLabel>Subject</SheetLabel>
                <SubjectPicker value={newClassroom.subject} onChange={v => setNewClassroom({ ...newClassroom, subject: v })} className="w-full" />
              </div>
              <div>
                <SheetLabel htmlFor="nc-desc" hint="optional">Description</SheetLabel>
                <textarea id="nc-desc" value={newClassroom.description} onChange={e => setNewClassroom({ ...newClassroom, description: e.target.value })} className={`${SHEET_INPUT} resize-none`} rows={2} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <SheetLabel hint="optional">Coordinator email</SheetLabel>
                  <UserEmailSuggest value={newClassroom.coordinator_email} onChange={v => { setNewClassroom({ ...newClassroom, coordinator_email: v }); setCreateError('') }} roles={['coordinator', 'principal', 'admin']} placeholder="coordinator@school.com" className={SHEET_INPUT} />
                </div>
                <div>
                  <SheetLabel hint="optional">Teacher email</SheetLabel>
                  <UserEmailSuggest value={newClassroom.teacher_email} onChange={v => setNewClassroom({ ...newClassroom, teacher_email: v })} roles={['teacher', 'coordinator', 'principal', 'admin']} placeholder="teacher@school.com" className={SHEET_INPUT} />
                </div>
              </div>
              {createError && <p role="alert" className="text-[12.5px] text-rose-600">{createError}</p>}
            </form>
          </ModalShell>
        )}
      </AnimatePresence>
      {/* Edit classroom */}
      <AnimatePresence>
        {editingClassroom && (
          <ModalShell
            key="classroom-edit"
            onClose={() => setEditingClassroom(null)}
            size="lg"
            title="Edit classroom"
            subtitle={editForm.title || undefined}
            icon={<Edit3 size={16} />}
            iconClassName="text-white [background:linear-gradient(135deg,#3D3B40,#8B6F47)]"
            footer={
              <SheetFooter onCancel={() => setEditingClassroom(null)}>
                <button
                  onClick={() => handleSaveEdit(editingClassroom)}
                  disabled={saving || !editForm.title.trim()}
                  className={SHEET_BTN_PRIMARY}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  Save changes
                </button>
              </SheetFooter>
            }
          >
            <div className="space-y-3.5">
              <div>
                <SheetLabel htmlFor="ec-title">Title</SheetLabel>
                <input id="ec-title" type="text" value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className={SHEET_INPUT} />
              </div>
              <div>
                <SheetLabel htmlFor="ec-desc" hint="optional">Description</SheetLabel>
                <textarea id="ec-desc" value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className={`${SHEET_INPUT} resize-none`} rows={2} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <SheetLabel htmlFor="ec-grade">Grade</SheetLabel>
                  <input id="ec-grade" type="number" inputMode="numeric" value={editForm.grade} onChange={e => setEditForm({ ...editForm, grade: e.target.value })} className={SHEET_INPUT} placeholder="10" min="1" max="12" />
                </div>
                <div>
                  <SheetLabel htmlFor="ec-section">Section</SheetLabel>
                  <input id="ec-section" type="text" value={editForm.section} onChange={e => setEditForm({ ...editForm, section: e.target.value })} className={SHEET_INPUT} placeholder="A" maxLength={5} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <SheetLabel htmlFor="ec-year">Academic year</SheetLabel>
                  <select id="ec-year" value={editForm.academic_year} onChange={e => setEditForm({ ...editForm, academic_year: e.target.value })} className={SHEET_INPUT}>
                    <option value="">Choose…</option>
                    {ACADEMIC_YEARS.map(ay => <option key={ay} value={ay}>{ay}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <SheetLabel>Subject</SheetLabel>
                <SubjectPicker value={editForm.subject} onChange={v => setEditForm({ ...editForm, subject: v })} className="w-full" />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </ProtectedLayout>
  )
}

// ── Helpers ──

const ROLE_BADGE: Record<string, string> = {
  admin:       'bg-rose-50 text-rose-700 border-rose-200',
  principal:   'bg-violet-50 text-violet-700 border-violet-200',
  coordinator: 'bg-blue-50 text-blue-700 border-blue-200',
  teacher:     'bg-teal-50 text-teal-700 border-teal-200',
  student:     'bg-[#F4F4F5] text-[#52525B] border-[#D4D4D8]',
  smartboard:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  driver:      'bg-orange-50 text-orange-700 border-orange-200',
}

interface ClassroomRowProps {
  classroom: ClassroomWithDetails
  closed: boolean; isAdmin: boolean; expanded: boolean
  expandedDetails: ClassroomWithDetails | null
  addMemberEmailInput: string; addingMember: string | null; memberError: string
  onExpand: () => void; onStartEdit: () => void
  onAddMemberEmailChange: (v: string) => void; onAddMember: () => void
  onRemoveMember: (userId: string) => void; onDelete: () => void; onToggleClose: () => void
  onImported: () => void
}

function ClassroomRow({
  classroom, closed, isAdmin, expanded, expandedDetails,
  addMemberEmailInput, addingMember, memberError,
  onExpand, onStartEdit,
  onAddMemberEmailChange, onAddMember, onRemoveMember, onDelete, onToggleClose, onImported,
}: ClassroomRowProps) {
  const [showMembers, setShowMembers] = useState(false)

  // A smart board is an account with role 'smartboard'; it joins the roster at
  // teacher level, so its membership role says nothing about what it is.
  const academicYear = classroom.start_date
    ? `${parseInt(classroom.start_date.split('-')[0])}-${String(parseInt(classroom.start_date.split('-')[0]) + 1).slice(-2)}`
    : ''

  const boards = useMemo(
    () => (expandedDetails?.members ?? []).filter(m => m.user?.role === 'smartboard'),
    [expandedDetails],
  )

  return (
    <motion.div variants={itemVariants}>
      {/* Row */}
      <div
        className={`flex items-center gap-3 px-3 py-2 sm:py-1.5 bg-white border-b border-[#E4E4E7] last:border-b-0 hover:bg-[#F5F4F1] transition-colors cursor-pointer ${closed ? 'opacity-60' : ''}`}
        onClick={onExpand}
      >
        {/* Icon dot */}
        <div className={`w-2 h-2 flex-shrink-0 rounded-full ${closed ? 'bg-[#D4D4D8]' : 'bg-[#71717A]'}`} />

        {/* Title, with subject, year and members underneath on a phone */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`min-w-0 break-words text-[13px] font-semibold leading-tight ${closed ? 'text-[#71717A]' : 'text-[#18181B]'}`}>{classroom.title}</span>
            {closed && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-[#27272A] text-[#D4D4D8]">Closed</span>}
          </div>
          {classroom.description && (
            <p className="hidden sm:block min-w-0 break-words text-[11px] leading-tight text-[#71717A] mt-0.5">{classroom.description}</p>
          )}
          <p className="sm:hidden flex flex-wrap gap-x-2.5 text-[11px] leading-snug text-[#71717A] mt-0.5">
            {classroom.subject && <span className="inline-flex items-center gap-1"><Tag size={10} />{classroom.subject}</span>}
            {academicYear && <span>{academicYear}</span>}
            <span>{classroom.member_count ?? 0} members</span>
          </p>
        </div>

        <span className="hidden sm:block w-32 flex-shrink-0 min-w-0 text-xs text-[#71717A] break-words">
          {classroom.subject}
        </span>
        <span className="hidden sm:block text-xs text-[#71717A] w-16 flex-shrink-0 tabular-nums">{academicYear}</span>
        <span className="hidden sm:block text-xs text-[#71717A] w-20 flex-shrink-0 tabular-nums">
          {classroom.member_count ?? 0}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 sm:w-32 justify-end flex-shrink-0">
          <Link href={`/classrooms/${classroom.id}`} onClick={e => e.stopPropagation()} className="p-1.5 rounded-lg text-[#71717A] hover:text-[#27272A] hover:bg-[#E4E4E7] transition-colors" title="Open classroom" aria-label="Open classroom">
            <ExternalLink size={14} />
          </Link>
          {isAdmin && (
            <>
              <button onClick={e => { e.stopPropagation(); onToggleClose() }} className={`hidden sm:inline-flex p-1.5 rounded-lg transition-colors ${closed ? 'text-[#71717A] hover:text-emerald-600 hover:bg-emerald-50' : 'text-[#71717A] hover:text-amber-600 hover:bg-amber-50'}`} title={closed ? 'Reopen' : 'Close'} aria-label={closed ? 'Reopen classroom' : 'Close classroom'}>
                {closed ? <Lock size={14} /> : <LockOpen size={14} />}
              </button>
              <button onClick={e => { e.stopPropagation(); onStartEdit() }} className="hidden sm:inline-flex p-1.5 rounded-lg text-[#71717A] hover:text-[#27272A] hover:bg-[#E4E4E7] transition-colors" title="Edit" aria-label="Edit classroom">
                <Edit3 size={14} />
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete() }} className="hidden sm:inline-flex p-1.5 rounded-lg text-[#71717A] hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Delete" aria-label="Delete classroom">
                <Trash2 size={14} />
              </button>
            </>
          )}
          <div className="p-1.5 text-[#71717A]">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-b border-[#E4E4E7] bg-[#F5F5F5] px-3 sm:px-5 py-3 sm:py-4 space-y-3 sm:space-y-4">

              {/* On a phone the row has room for two icons only; the rest live here. */}
              {isAdmin && (
                <div className="sm:hidden flex flex-wrap gap-2">
                  <button onClick={onStartEdit} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-[#D4D4D8] text-[13px] font-medium text-[#18181B]">
                    <Edit3 size={13} /> Edit
                  </button>
                  <button onClick={onToggleClose} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-[#D4D4D8] text-[13px] font-medium text-[#18181B]">
                    {closed ? <LockOpen size={13} /> : <Lock size={13} />} {closed ? 'Reopen' : 'Close'}
                  </button>
                  <button onClick={onDelete} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-rose-200 text-[13px] font-medium text-rose-600">
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              )}

              {/* Add member */}
              {isAdmin && !closed && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <UserEmailSuggest
                      value={addMemberEmailInput} onChange={v => onAddMemberEmailChange(v)}
                      placeholder="Email to add"
                      className="border border-[#D4D4D8] bg-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full"
                    />
                  </div>
                  <button onClick={onAddMember} disabled={addingMember === classroom.id} className="px-4 py-2 rounded-full bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50 flex-shrink-0 flex items-center gap-1.5">
                    {addingMember === classroom.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Add
                  </button>
                </div>
              )}
              {memberError && <p className="text-xs text-rose-600">{memberError}</p>}

              {/* Members toggle */}
              <button
                type="button"
                onClick={() => setShowMembers(v => !v)}
                className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-white border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors"
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3F3F46]">
                  <Users size={13} /> Members
                  {expandedDetails && <span className="font-normal text-[#71717A] normal-case">({expandedDetails.members.length})</span>}
                </span>
                <ChevronDown size={13} className={`text-[#71717A] transition-transform ${showMembers ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {showMembers && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="max-h-[480px] overflow-y-auto space-y-1 mt-1">
                      {!expandedDetails ? (
                        <div className="flex items-center gap-2 text-sm text-[#71717A] px-3 py-3">
                          <Loader2 size={14} className="animate-spin text-[#A1A1AA]" /> Loading members…
                        </div>
                      ) : expandedDetails.members.length === 0 ? (
                        <p className="text-sm text-[#71717A] px-3 py-3">No members yet</p>
                      ) : (
                        expandedDetails.members.map(member => (
                          <div key={member.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white border border-[#E4E4E7] hover:bg-[#EBEBEB] transition-colors">
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={26} userId={member.user?.id} profileSeed={member.user} />
                              <div className="min-w-0">
                                <p className="break-words text-[13px] font-medium leading-tight text-[#18181B]">{member.user?.full_name || 'Unknown'}</p>
                                <p className="break-all text-[11px] leading-tight text-[#71717A]">{member.user?.email}</p>
                              </div>
                              {/* The person's own label — their admin-set display_role
                                  ("HM") when they have one, else the standard name for
                                  their profile role. member.role is this classroom's
                                  access level, which is why a coordinator added here
                                  used to read "Teacher". */}
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ml-1 flex-shrink-0 whitespace-nowrap ${ROLE_BADGE[member.user?.role ?? member.role] ?? ROLE_BADGE.student}`}>
                                {member.user ? getDisplayRole(member.user) : member.role}
                              </span>
                            </div>
                            {isAdmin && !closed && (
                              <button onClick={() => onRemoveMember(member.user_id)} className="p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Remove">
                                <UserMinus size={13} />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Import homeroom (students + its smart board + its class teacher) */}
              {isAdmin && !closed && (
                <HomeroomImport classroomId={classroom.id} onImported={onImported} />
              )}

              {/* Smart boards already in the classroom, and a picker to add more */}
              {isAdmin && !closed && (
                <ClassroomSmartboards
                  classroomId={classroom.id}
                  boards={boards}
                  loaded={!!expandedDetails}
                  onChanged={onImported}
                  onRemove={onRemoveMember}
                />
              )}

              {closed && !isAdmin && (
                <p className="text-xs text-[#71717A] flex items-center gap-1">
                  <Lock size={11} /> This classroom is closed. Contact an admin to make changes.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Import Homeroom ──
// Adds every student of a homeroom into the classroom, plus the two accounts
// that belong to the homeroom itself rather than to its roster — its smart
// board and its class teacher — both at staff level (when they exist).
function HomeroomImport({ classroomId, onImported }: { classroomId: string; onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Homeroom[]>([])
  const [searching, setSearching] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [result, setResult] = useState<{ name: string; students: number; board: boolean; hadBoard: boolean; teacher: boolean; hadTeacher: boolean } | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setSearching(true)
    const t = setTimeout(async () => {
      const data = await searchHomerooms(query)
      if (active) { setResults(data); setSearching(false) }
    }, 200)
    return () => { active = false; clearTimeout(t) }
  }, [query, open])

  const handleImport = async (hr: Homeroom) => {
    setImportingId(hr.id); setResult(null)
    const res = await importHomeroomIntoClassroom(classroomId, hr.id)
    setImportingId(null)
    if (res.success) {
      setResult({
        name: hr.name, students: res.studentsAdded,
        board: res.smartboardAdded, hadBoard: res.hadSmartboard,
        teacher: res.classTeacherAdded, hadTeacher: res.hadClassTeacher,
      })
      onImported()
    }
  }

  return (
    <div className="border border-[#D4D4D8] bg-white rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-2 px-3 hover:bg-[#EBEBEB] transition-colors"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3F3F46]">
          <Home size={13} /> Import a homeroom
        </span>
        <ChevronDown size={13} className={`text-[#71717A] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-[#E4E4E7] p-3 space-y-2">
          <p className="text-[11px] text-[#71717A]">
            Adds all homeroom students, and brings the homeroom&rsquo;s own accounts with it —
            its smart board and its <strong>class teacher</strong> — both with teacher access.
          </p>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
            <input
              type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search homerooms (e.g. 9A)…"
              className="w-full border border-[#D4D4D8] bg-white rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#27272A]"
            />
          </div>

          {result && (
            <div className={`flex items-start gap-2 text-xs rounded px-2.5 py-1.5 border ${(result.hadBoard && !result.board) || (result.hadTeacher && !result.teacher) ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
              <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                Imported <strong>{result.name}</strong>: {result.students} student{result.students !== 1 ? 's' : ''}
                {result.board ? ' + smart board' : ''}
                {result.teacher ? ' + class teacher' : ''}.
                {result.hadBoard && !result.board ? ' The smart board could not be added.' : ''}
                {!result.hadBoard ? ' No smart board linked to this homeroom.' : ''}
                {result.hadTeacher && !result.teacher ? ' The class teacher could not be added.' : ''}
                {!result.hadTeacher ? ' No class teacher set for this homeroom.' : ''}
              </span>
            </div>
          )}

          <div className="max-h-48 overflow-y-auto space-y-1">
            {searching ? (
              <div className="flex items-center gap-2 text-xs text-[#71717A] py-2 px-1">
                <Loader2 size={13} className="animate-spin" /> Searching…
              </div>
            ) : results.length === 0 ? (
              <p className="text-xs text-[#A1A1AA] py-2 px-1">No homerooms found.</p>
            ) : (
              results.map(hr => (
                <div key={hr.id} className="flex items-center gap-2 py-1.5 px-2 border border-[#E4E4E7] rounded hover:bg-[#F5F5F5]">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#18181B] min-w-0 break-words flex items-center gap-1.5">
                      {hr.name}
                      {hr.smartboard_id && <MonitorPlay size={11} className="text-indigo-500 flex-shrink-0" />}
                    </p>
                    {/* Names the teacher who will come along, so the import is
                        never a surprise addition to the classroom roster. */}
                    <p className="text-[11px] text-[#71717A] break-words">
                      {hr.class_teacher
                        ? <>Class teacher: {hr.class_teacher.full_name}</>
                        : 'No class teacher set'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleImport(hr)}
                    disabled={importingId === hr.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-xs font-medium transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {importingId === hr.id ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />}
                    Import
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Smart Boards ──
// The classroom's smart board accounts: what is already linked, and a picker
// to link another. Deliberately shaped like the Homeroom Manager's smart board
// panel — same indigo tile, same dashed "add" affordance — so the two managers
// read as one product. It goes further than that one in the ways this screen
// needs: a classroom can hold several boards, so they are listed with a count
// and each can be unlinked, and accounts already in the classroom are dropped
// from the picker instead of offering an add that would do nothing.
function ClassroomSmartboards({ classroomId, boards, loaded, onChanged, onRemove }: {
  classroomId: string
  boards: ClassroomMember[]
  loaded: boolean
  onChanged: () => void
  onRemove: (userId: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const [accounts, setAccounts] = useState<UserProfile[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [query, setQuery] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!picking || accounts.length > 0) return
    setLoadingAccounts(true)
    fetchSmartboardAccounts().then(data => { setAccounts(data); setLoadingAccounts(false) })
  }, [picking, accounts.length])

  const linkedIds = useMemo(() => new Set(boards.map(b => b.user_id)), [boards])

  const q = query.trim().toLowerCase()
  const available = accounts.filter(a =>
    !linkedIds.has(a.id) &&
    (!q || a.full_name?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q)))

  const handleAdd = async (acc: UserProfile) => {
    setAddingId(acc.id); setError('')
    const ok = await addSmartboardToClassroom(classroomId, acc.id)
    setAddingId(null)
    if (ok) onChanged()
    else setError(`Could not add ${acc.full_name}. It may already be a member.`)
  }

  return (
    <div className="border border-[#D4D4D8] bg-white rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#E4E4E7]">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3F3F46]">
          <MonitorPlay size={13} className="text-indigo-500" /> Smart boards
          {loaded && <span className="font-normal text-[#71717A] normal-case">({boards.length})</span>}
        </span>
        {loaded && !picking && (
          <button
            type="button"
            onClick={() => { setPicking(true); setError('') }}
            className="flex items-center gap-1 rounded-md border border-dashed border-indigo-300 px-2 py-1 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
          >
            <Plus size={11} /> Add board
          </button>
        )}
      </div>

      <div className="p-3 space-y-2">
        {!loaded ? (
          <div className="flex items-center gap-2 text-xs text-[#71717A] py-1">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </div>
        ) : boards.length === 0 ? (
          <p className="text-[11px] text-[#A1A1AA]">
            No smart board in this classroom yet. Importing a homeroom brings its board along, or add one directly.
          </p>
        ) : (
          <div className="space-y-1">
            {boards.map(b => (
              <div key={b.id} className="flex items-center gap-2.5 rounded-lg border border-indigo-100 bg-white px-2.5 py-2">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
                  <MonitorPlay size={14} className="text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-[#18181B]">{b.user?.full_name}</p>
                  <p className="break-all text-[11px] text-[#71717A]">{b.user?.email}</p>
                </div>
                <span className="flex-shrink-0 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                  Board
                </span>
                <button
                  onClick={() => onRemove(b.user_id)}
                  className="flex-shrink-0 p-1.5 text-[#71717A] transition-colors hover:bg-rose-50 hover:text-rose-600"
                  title="Remove from classroom"
                >
                  <UserMinus size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {picking && (
          <div className="space-y-2 rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-[#71717A]">Boards join with teacher-level access.</p>
              <button
                onClick={() => { setPicking(false); setQuery(''); setError('') }}
                className="p-0.5 text-[#A1A1AA] transition-colors hover:text-[#27272A]"
                title="Done"
              >
                <X size={13} />
              </button>
            </div>

            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
              <input
                type="text" value={query} onChange={e => setQuery(e.target.value)}
                autoFocus
                placeholder="Search smart board accounts…"
                className="w-full rounded-lg border border-[#D4D4D8] bg-white py-2 pl-8 pr-3 text-sm focus:border-[#27272A] focus:outline-none"
              />
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}

            <div className="max-h-52 space-y-1 overflow-y-auto">
              {loadingAccounts ? (
                <div className="flex items-center gap-2 px-1 py-2 text-xs text-[#71717A]">
                  <Loader2 size={13} className="animate-spin" /> Loading accounts…
                </div>
              ) : available.length === 0 ? (
                <p className="px-1 py-2 text-xs text-[#A1A1AA]">
                  {accounts.length === 0
                    ? 'There are no smart board accounts yet. Create one in Homerooms.'
                    : query
                      ? 'No smart board matches that search.'
                      : 'Every smart board account is already in this classroom.'}
                </p>
              ) : (
                available.map(acc => (
                  <div key={acc.id} className="flex items-center gap-2.5 rounded-lg border border-[#E4E4E7] bg-white px-2.5 py-1.5 hover:bg-[#F5F5F5]">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
                      <MonitorPlay size={13} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-[#18181B]">{acc.full_name}</p>
                      <p className="break-all text-[11px] text-[#71717A]">{acc.email}</p>
                    </div>
                    <button
                      onClick={() => handleAdd(acc)}
                      disabled={addingId === acc.id}
                      className="flex flex-shrink-0 items-center gap-1 rounded-md bg-[#27272A] px-2.5 py-1 text-xs font-medium text-[#F5F5F5] transition-colors hover:bg-[#18181B] disabled:opacity-50"
                    >
                      {addingId === acc.id ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      Add
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
