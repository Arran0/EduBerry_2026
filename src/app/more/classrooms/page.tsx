'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import Link from 'next/link'
import PageBanner from '@/components/PageBanner'
import UserEmailSuggest from '@/components/UserEmailSuggest'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import {
  BookOpen,
  Plus,
  X,
  UserMinus,
  ChevronDown,
  ChevronUp,
  Calendar,
  Edit3,
  Save,
  Loader2,
  Users,
  Lock,
  LockOpen,
  Trash2,
  ExternalLink,
  Search,
  Tag,
  Home,
  MonitorPlay,
  DownloadCloud,
  CheckCircle2,
} from 'lucide-react'
import SubjectPicker from '@/components/classrooms/SubjectPicker'
import { Homeroom, searchHomerooms } from '@/lib/homerooms'
import { importHomeroomIntoClassroom, fetchSmartboardAccounts, addSmartboardToClassroom, fetchSmartboardIdsForGradeSection } from '@/lib/smartboard'
import { UserProfile } from '@/lib/supabase'
import { CLASSROOMS_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  ClassroomWithDetails,
  fetchClassroomsForUser,
  createClassroom,
  updateClassroom,
  fetchClassroomById,
  addMemberByEmail,
  addClassroomMember,
  removeClassroomMember,
  deleteClassroom,
  isClassroomClosed,
} from '@/lib/classrooms'
import { supabase } from '@/lib/supabase'

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.03 } },
}

const itemVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
}

// Admin input style helper
const ai = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'
const aiSm = 'border border-[#D4D4D8] bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'

export default function ClassroomManagerPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const router = useRouter()

  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [loading, setLoading] = useState(true)
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

  const loadClassrooms = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    const data = await fetchClassroomsForUser(user.id, profile.role, true)
    setClassrooms(data)
    setLoading(false)
  }, [user, profile])

  useEffect(() => { loadClassrooms() }, [loadClassrooms])

  const loadClassroomDetails = async (classroomId: string) => {
    const details = await fetchClassroomById(classroomId)
    if (details) setExpandedDetails(details)
  }

  const handleToggleClose = async (classroom: ClassroomWithDetails) => {
    if (isClassroomClosed(classroom)) {
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
        alert('Coordinator email not found or user does not have coordinator/principal/admin role.')
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

      // Fetch default members and students in parallel; fire teacher add concurrently
      const [defaultRes, studentsRes] = await Promise.all([
        supabase.from('profiles').select('id, role').in('role', ['principal', 'admin']),
        gradeNum && section
          ? supabase.from('profiles').select('id').eq('role', 'student').eq('grade', gradeNum).eq('section', section)
          : Promise.resolve({ data: [] as { id: string }[] }),
      ])
      if (newClassroom.teacher_email.trim()) {
        await addMemberByEmail(result.id, newClassroom.teacher_email.trim())
      }

      // Bulk-insert admins/principals in one query instead of N sequential ones
      const defaultRows = ((defaultRes.data ?? []) as { id: string; role: string }[])
        .filter(m => m.id !== user.id && m.id !== coordinatorId)
        .map(m => ({ classroom_id: result.id, user_id: m.id, role: m.role }))
      if (defaultRows.length > 0) {
        const { error } = await supabase.from('classroom_members').insert(defaultRows)
        if (error && error.code !== '23505') console.error('Failed to add default members:', error.message)
      }

      // Bulk-insert matching students in one query instead of N sequential ones
      const studentRows = ((studentsRes.data ?? []) as { id: string }[])
        .map(s => ({ classroom_id: result.id, user_id: s.id, role: 'student' }))
      if (studentRows.length > 0) {
        const { error } = await supabase.from('classroom_members').insert(studentRows)
        if (error && error.code !== '23505') console.error('Failed to bulk-add students:', error.message)
      }

      // Auto-enrol the grade/section's smart board(s) with teacher-level access,
      // mirroring the student auto-enrolment above.
      if (gradeNum && section) {
        const boardIds = await fetchSmartboardIdsForGradeSection(gradeNum, section)
        const boardRows = boardIds
          .filter(id => id !== user.id && id !== coordinatorId)
          .map(id => ({ classroom_id: result.id, user_id: id, role: 'teacher' }))
        if (boardRows.length > 0) {
          const { error } = await supabase.from('classroom_members').insert(boardRows)
          if (error && error.code !== '23505') console.error('Failed to add smart board(s):', error.message)
        }
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
    if (!window.confirm(`Delete classroom "${title}"? This cannot be undone.`)) return
    const ok = await deleteClassroom(classroomId)
    if (ok) {
      if (expandedClassroom === classroomId) { setExpandedClassroom(null); setExpandedDetails(null) }
      await loadClassrooms()
    }
  }

  if (!user || !profile) return null

  const searchLower = classroomSearch.trim().toLowerCase()
  const filteredClassrooms = searchLower
    ? classrooms.filter(c => c.title.toLowerCase().includes(searchLower) || (c.description && c.description.toLowerCase().includes(searchLower)))
    : classrooms
  const activeClassrooms = filteredClassrooms.filter(c => !isClassroomClosed(c))
  const closedClassrooms = filteredClassrooms.filter(c => isClassroomClosed(c))

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ backgroundColor: '#FDFCF9', minHeight: '100vh' }}>
        <PageBanner
          settingKey="classrooms_banner"
          defaultBanner={CLASSROOMS_BANNER_DEFAULT}
          icon={<BookOpen size={26} className="text-white" />}
          title="Classroom Management"
          subtitle={!loading && classrooms.length > 0
            ? `${activeClassrooms.length} active · ${closedClassrooms.length} closed`
            : 'Create and manage classrooms'}
          isAdmin={isAdmin}
          onEditingChange={setBannerEditing}
          onBack={() => router.back()}
          maxWidth="max-w-7xl"
          actions={isAdmin ? (
            <>
              <button
                onClick={() => setShowCreateForm(v => !v)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg border border-[#27272A] transition-colors"
              >
                {showCreateForm ? <X size={15} /> : <Plus size={15} />}
                {showCreateForm ? 'Cancel' : 'New Classroom'}
              </button>
              <button
                onClick={() => setShowCreateForm(v => !v)}
                className="sm:hidden w-10 h-10 bg-[#27272A] hover:bg-[#18181B] border border-[#27272A] rounded-lg flex items-center justify-center text-white transition-colors"
              >
                {showCreateForm ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          ) : undefined}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10" style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Search bar */}
          {!loading && classrooms.length > 0 && (
            <div className="mb-3 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
              <input
                type="text" value={classroomSearch}
                onChange={e => setClassroomSearch(e.target.value)}
                className="w-full border border-[#D4D4D8] bg-white pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors placeholder:text-[#A1A1AA] rounded-xl shadow-lg"
                placeholder="Search classrooms by title or description…"
              />
              {classroomSearch && (
                <button onClick={() => setClassroomSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A]">
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          {/* Create form */}
          <AnimatePresence>
            {showCreateForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="mb-3 overflow-hidden"
              >
                <form onSubmit={handleCreateClassroom} className="border border-[#D4D4D8] border-l-4 border-l-[#525252] bg-[#F5F5F5] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#D4D4D8] bg-[#27272A]">
                    <span className="text-sm font-bold text-[#F5F5F5]">New Classroom</span>
                    <button type="button" onClick={() => setShowCreateForm(false)} className="p-1 text-[#F5F5F5]/60 hover:text-[#F5F5F5] transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Title *</label>
                        <input type="text" value={newClassroom.title} onChange={e => setNewClassroom({ ...newClassroom, title: e.target.value })} className={ai} placeholder="e.g., Class 10-A Science" required />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Grade</label>
                          <input type="number" value={newClassroom.grade} onChange={e => setNewClassroom({ ...newClassroom, grade: e.target.value })} className={ai} placeholder="10" min="1" max="12" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Section</label>
                          <input type="text" value={newClassroom.section} onChange={e => setNewClassroom({ ...newClassroom, section: e.target.value })} className={ai} placeholder="A" maxLength={5} />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Subject</label>
                      <SubjectPicker value={newClassroom.subject} onChange={v => setNewClassroom({ ...newClassroom, subject: v })} className="w-full" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Description</label>
                      <textarea value={newClassroom.description} onChange={e => setNewClassroom({ ...newClassroom, description: e.target.value })} className={`${ai} resize-none`} rows={2} placeholder="Brief description…" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Coordinator Email</label>
                        <UserEmailSuggest value={newClassroom.coordinator_email} onChange={v => setNewClassroom({ ...newClassroom, coordinator_email: v })} roles={['coordinator', 'principal', 'admin']} placeholder="coordinator@school.com" className={ai} />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Teacher Email</label>
                        <UserEmailSuggest value={newClassroom.teacher_email} onChange={v => setNewClassroom({ ...newClassroom, teacher_email: v })} roles={['teacher', 'coordinator', 'principal', 'admin']} placeholder="teacher@school.com" className={ai} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Academic Year *</label>
                      <select value={newClassroom.academic_year} onChange={e => { setNewClassroom({ ...newClassroom, academic_year: e.target.value }); setCreateError('') }} className={ai}>
                        <option value="">Select academic year…</option>
                        {Array.from({ length: 21 }, (_, i) => { const y = 2020 + i; return `${y}-${String(y+1).slice(-2)}` }).map(ay => (
                          <option key={ay} value={ay}>{ay}</option>
                        ))}
                      </select>
                      {createError && <p className="text-xs text-rose-600 mt-1">{createError}</p>}
                    </div>
                    <div className="flex justify-end gap-3 pt-1">
                      <button type="button" onClick={() => { setShowCreateForm(false); setCreateError('') }} className="px-4 py-2 border border-[#D4D4D8] text-[#18181B] text-sm hover:bg-[#EBEBEB] transition-colors">Cancel</button>
                      <button type="submit" disabled={creating} className="flex items-center gap-2 px-5 py-2 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50">
                        {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Create Classroom
                      </button>
                    </div>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* List */}
          {loading ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] py-16 text-center">
              <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A1A1AA]" />
              <p className="text-sm text-[#71717A]">Loading classrooms…</p>
            </div>
          ) : classrooms.length === 0 ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] p-12 text-center">
              <BookOpen size={36} className="text-[#D4D4D8] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#18181B] mb-1">No Classrooms Yet</p>
              <p className="text-sm text-[#71717A] mb-5">Create your first classroom to get started.</p>
              {isAdmin && (
                <button onClick={() => setShowCreateForm(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors mx-auto">
                  <Plus size={14} /> Create Classroom
                </button>
              )}
            </div>
          ) : filteredClassrooms.length === 0 && classroomSearch ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] p-10 text-center">
              <p className="text-sm text-[#71717A]">No classrooms match &ldquo;{classroomSearch}&rdquo;</p>
            </div>
          ) : (
            <div className="border border-[#D4D4D8] rounded-xl overflow-hidden">
              {/* Column headers */}
              <div className="bg-[#27272A] px-4 py-2.5 hidden sm:flex items-center gap-3">
                <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Title</span>
                <span className="w-28 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Subject</span>
                <span className="w-20 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">A.Y.</span>
                <span className="w-20 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Members</span>
                <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
              </div>

              {/* Active section */}
              {activeClassrooms.length > 0 && (
                <>
                  {(activeClassrooms.length > 0 && closedClassrooms.length > 0) && (
                    <div className="bg-[#27272A]/90 px-4 py-1.5 flex items-center gap-2 border-t border-[#27272A]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Active</span>
                      <span className="text-[10px] text-[#A1A1AA]/60 font-medium">{activeClassrooms.length}</span>
                    </div>
                  )}
                  <motion.div variants={containerVariants} initial="hidden" animate="show">
                    {activeClassrooms.map(classroom => (
                      <ClassroomRow
                        key={classroom.id}
                        classroom={classroom} closed={false} isAdmin={isAdmin}
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
                    ))}
                  </motion.div>
                </>
              )}

              {/* Closed section */}
              {closedClassrooms.length > 0 && (
                <>
                  <div className="bg-[#27272A]/90 px-4 py-1.5 flex items-center gap-2 border-t border-[#27272A]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Closed</span>
                    <span className="text-[10px] text-[#A1A1AA]/60 font-medium">{closedClassrooms.length}</span>
                  </div>
                  <motion.div variants={containerVariants} initial="hidden" animate="show">
                    {closedClassrooms.map(classroom => (
                      <ClassroomRow
                        key={classroom.id}
                        classroom={classroom} closed={true} isAdmin={isAdmin}
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
                    ))}
                  </motion.div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editingClassroom && createPortal(
        <AnimatePresence>
          <motion.div
            key="classroom-edit-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            onClick={() => setEditingClassroom(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.18 }}
              className="bg-white shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] rounded-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
                <h2 className="text-base font-semibold text-white">Edit Classroom</h2>
                <button onClick={() => setEditingClassroom(null)} className="text-white/60 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Title *</label>
                  <input type="text" value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className={ai} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Description</label>
                  <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className={`${ai} resize-none`} rows={2} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Academic Year</label>
                  <select value={editForm.academic_year} onChange={e => setEditForm({ ...editForm, academic_year: e.target.value })} className={ai}>
                    <option value="">Select year…</option>
                    {Array.from({ length: 21 }, (_, i) => { const y = 2020 + i; return `${y}-${String(y + 1).slice(-2)}` }).map(ay => (
                      <option key={ay} value={ay}>{ay}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Grade</label>
                    <input type="number" value={editForm.grade} onChange={e => setEditForm({ ...editForm, grade: e.target.value })} className={ai} placeholder="10" min="1" max="12" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Section</label>
                    <input type="text" value={editForm.section} onChange={e => setEditForm({ ...editForm, section: e.target.value })} className={ai} placeholder="A" maxLength={5} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Subject</label>
                  <SubjectPicker value={editForm.subject} onChange={v => setEditForm({ ...editForm, subject: v })} className="w-full" />
                </div>
              </div>
              <div className="flex gap-3 px-6 py-4 border-t border-[#E4E4E7] flex-shrink-0">
                <button
                  onClick={() => handleSaveEdit(editingClassroom)} disabled={saving || !editForm.title.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Save Changes
                </button>
                <button onClick={() => setEditingClassroom(null)} className="px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F5F5F5] transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
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
}

interface EditFormState {
  title: string; description: string; academic_year: string; grade: string; section: string; subject: string
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

  return (
    <motion.div variants={itemVariants}>
      {/* Row */}
      <div
        className={`flex items-center gap-3 px-4 py-3 border-b border-[#E4E4E7] last:border-b-0 hover:bg-[#EBEBEB] transition-colors cursor-pointer ${closed ? 'opacity-60' : ''}`}
        onClick={onExpand}
      >
        {/* Icon dot */}
        <div className={`w-2 h-2 flex-shrink-0 rounded-full ${closed ? 'bg-[#D4D4D8]' : 'bg-[#71717A]'}`} />

        {/* Title + subject */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold truncate ${closed ? 'text-[#71717A]' : 'text-[#18181B]'}`}>{classroom.title}</span>
            {closed && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-[#27272A] text-[#A1A1AA]">Closed</span>}
          </div>
          {classroom.description && (
            <p className="hidden sm:block text-xs text-[#71717A] truncate">{classroom.description}</p>
          )}
        </div>

        {/* Subject — desktop */}
        <div className="hidden sm:block w-28 flex-shrink-0">
          {classroom.subject ? (
            <span className="text-xs text-[#71717A] flex items-center gap-1 truncate">
              <Tag size={10} className="flex-shrink-0" /> {classroom.subject}
            </span>
          ) : null}
        </div>

        {/* AY — desktop */}
        <span className="hidden sm:block text-xs text-[#71717A] w-20 flex-shrink-0">
          {classroom.start_date
            ? `${parseInt(classroom.start_date.split('-')[0])}-${String(parseInt(classroom.start_date.split('-')[0]) + 1).slice(-2)}`
            : ''}
        </span>

        {/* Members — desktop */}
        <span className="hidden sm:block text-xs text-[#71717A] w-20 flex-shrink-0">
          {classroom.member_count ?? 0} members
        </span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 w-32 justify-end flex-shrink-0">
          <Link href={`/classrooms/${classroom.id}`} onClick={e => e.stopPropagation()} className="p-1.5 text-[#71717A] hover:text-[#27272A] hover:bg-[#E4E4E7] transition-colors" title="View classroom">
            <ExternalLink size={14} />
          </Link>
          {isAdmin && (
            <>
              <button onClick={e => { e.stopPropagation(); onToggleClose() }} className={`p-1.5 transition-colors ${closed ? 'text-[#71717A] hover:text-emerald-600 hover:bg-emerald-50' : 'text-[#71717A] hover:text-amber-600 hover:bg-amber-50'}`} title={closed ? 'Reopen' : 'Close'}>
                {closed ? <Lock size={14} /> : <LockOpen size={14} />}
              </button>
              <button onClick={e => { e.stopPropagation(); onStartEdit() }} className="p-1.5 text-[#71717A] hover:text-[#27272A] hover:bg-[#E4E4E7] transition-colors" title="Edit">
                <Edit3 size={14} />
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete() }} className="p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Delete">
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
            <div className="border-b border-[#E4E4E7] bg-[#F5F5F5] px-5 py-4 space-y-4">

              {/* Add member */}
              {isAdmin && !closed && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <UserEmailSuggest
                      value={addMemberEmailInput} onChange={v => onAddMemberEmailChange(v)}
                      placeholder="Add member by email…"
                      className="border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full"
                    />
                  </div>
                  <button onClick={onAddMember} disabled={addingMember === classroom.id} className="px-4 py-2 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50 flex-shrink-0 flex items-center gap-1.5">
                    {addingMember === classroom.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Add
                  </button>
                </div>
              )}
              {memberError && <p className="text-xs text-rose-600">{memberError}</p>}

              {/* Import homeroom (students + its smart board account) */}
              {isAdmin && !closed && (
                <HomeroomImport classroomId={classroom.id} onImported={onImported} />
              )}

              {/* Add a smart board account directly (teacher-level access) */}
              {isAdmin && !closed && (
                <SmartboardAdd classroomId={classroom.id} onAdded={onImported} />
              )}

              {/* Members toggle */}
              <button
                type="button"
                onClick={() => setShowMembers(v => !v)}
                className="w-full flex items-center justify-between py-2 px-3 bg-white border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#525252]">
                  <Users size={12} /> Members
                  {expandedDetails && <span className="font-normal text-[#71717A] normal-case">({expandedDetails.members.length})</span>}
                </span>
                <ChevronDown size={13} className={`text-[#71717A] transition-transform ${showMembers ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {showMembers && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="max-h-[480px] overflow-y-auto space-y-px mt-px">
                      {!expandedDetails ? (
                        <div className="flex items-center gap-2 text-sm text-[#71717A] px-3 py-3">
                          <Loader2 size={14} className="animate-spin text-[#A1A1AA]" /> Loading members…
                        </div>
                      ) : expandedDetails.members.length === 0 ? (
                        <p className="text-sm text-[#71717A] px-3 py-3">No members yet</p>
                      ) : (
                        expandedDetails.members.map(member => (
                          <div key={member.id} className="flex items-center justify-between py-2.5 px-3 bg-white border border-[#E4E4E7] hover:bg-[#EBEBEB] transition-colors">
                            <div className="flex items-center gap-3">
                              <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={30} userId={member.user?.id} />
                              <div>
                                <p className="text-sm font-medium text-[#18181B]">{member.user?.full_name || 'Unknown'}</p>
                                <p className="text-xs text-[#71717A]">{member.user?.email}</p>
                              </div>
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ml-1 ${ROLE_BADGE[member.role] ?? ROLE_BADGE.student}`}>{member.role}</span>
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
// Adds every student of a homeroom into the classroom, plus the homeroom's
// smart board account as a teacher-level member (when one exists).
function HomeroomImport({ classroomId, onImported }: { classroomId: string; onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Homeroom[]>([])
  const [searching, setSearching] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [result, setResult] = useState<{ name: string; students: number; board: boolean; hadBoard: boolean } | null>(null)

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
      setResult({ name: hr.name, students: res.studentsAdded, board: res.smartboardAdded, hadBoard: res.hadSmartboard })
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
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#525252]">
          <Home size={12} /> Import Homeroom
        </span>
        <ChevronDown size={13} className={`text-[#71717A] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-[#E4E4E7] p-3 space-y-2">
          <p className="text-[11px] text-[#71717A]">
            Adds all homeroom students and links its smart board account with teacher access.
          </p>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
            <input
              type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search homerooms (e.g. 9A)…"
              className="w-full border border-[#D4D4D8] bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#27272A]"
            />
          </div>

          {result && (
            <div className={`flex items-start gap-2 text-xs rounded px-2.5 py-1.5 border ${result.hadBoard && !result.board ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
              <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                Imported <strong>{result.name}</strong>: {result.students} student{result.students !== 1 ? 's' : ''}
                {result.board
                  ? ' + smart board'
                  : result.hadBoard
                    ? ' (smart board could not be added — check console)'
                    : ' (no smart board linked to this homeroom)'}.
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
                    <p className="text-sm font-medium text-[#18181B] truncate flex items-center gap-1.5">
                      {hr.name}
                      {hr.smartboard_id && <MonitorPlay size={11} className="text-indigo-500 flex-shrink-0" />}
                    </p>
                  </div>
                  <button
                    onClick={() => handleImport(hr)}
                    disabled={importingId === hr.id}
                    className="flex items-center gap-1 px-2.5 py-1 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-xs font-medium transition-colors disabled:opacity-50 flex-shrink-0"
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

// ── Add Smart Board ──
// Adds a smart board account to the classroom with teacher-level access.
function SmartboardAdd({ classroomId, onAdded }: { classroomId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedName, setAddedName] = useState<string | null>(null)

  useEffect(() => {
    if (!open || accounts.length > 0) return
    setLoading(true)
    fetchSmartboardAccounts().then(data => { setAccounts(data); setLoading(false) })
  }, [open, accounts.length])

  const handleAdd = async (acc: UserProfile) => {
    setAddingId(acc.id); setAddedName(null)
    const ok = await addSmartboardToClassroom(classroomId, acc.id)
    setAddingId(null)
    if (ok) { setAddedName(acc.full_name); onAdded() }
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? accounts.filter(a => a.full_name?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q))
    : accounts

  return (
    <div className="border border-[#D4D4D8] bg-white rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-2 px-3 hover:bg-[#EBEBEB] transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#525252]">
          <MonitorPlay size={12} className="text-indigo-500" /> Add Smart Board
        </span>
        <ChevronDown size={13} className={`text-[#71717A] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-[#E4E4E7] p-3 space-y-2">
          <p className="text-[11px] text-[#71717A]">Adds a smart board account to this classroom with teacher-level access.</p>

          {addedName && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5">
              <CheckCircle2 size={13} className="flex-shrink-0" />
              <span>Added <strong>{addedName}</strong>.</span>
            </div>
          )}

          {accounts.length > 3 && (
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
              <input
                type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search smart boards…"
                className="w-full border border-[#D4D4D8] bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#27272A]"
              />
            </div>
          )}

          <div className="max-h-48 overflow-y-auto space-y-1">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-[#71717A] py-2 px-1">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-[#A1A1AA] py-2 px-1">No smart board accounts found.</p>
            ) : (
              filtered.map(acc => (
                <div key={acc.id} className="flex items-center gap-2 py-1.5 px-2 border border-[#E4E4E7] rounded hover:bg-[#F5F5F5]">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
                    <MonitorPlay size={13} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#18181B] truncate">{acc.full_name}</p>
                    <p className="text-[11px] text-[#71717A] truncate">{acc.email}</p>
                  </div>
                  <button
                    onClick={() => handleAdd(acc)}
                    disabled={addingId === acc.id}
                    className="flex items-center gap-1 px-2.5 py-1 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-xs font-medium transition-colors disabled:opacity-50 flex-shrink-0"
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
  )
}
