'use client'

import React, { useState, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import SubjectPicker from '@/components/classrooms/SubjectPicker'
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
  const [expandedDetails, setExpandedDetails] = useState<ClassroomWithDetails | null>(null)

  const [newClassroom, setNewClassroom] = useState({
    title: '', description: '', grade: '', section: '', subject: '',
    academic_year: '', coordinator_email: '', teacher_email: '',
  })
  const [creating, setCreating] = useState(false)

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
      setExpandedClassroom(null); setExpandedDetails(null); setEditingClassroom(null)
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

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

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
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Academic Year</label>
                      <select value={newClassroom.academic_year} onChange={e => setNewClassroom({ ...newClassroom, academic_year: e.target.value })} className={ai}>
                        <option value="">Select academic year…</option>
                        {Array.from({ length: 21 }, (_, i) => { const y = 2020 + i; return `${y}-${String(y+1).slice(-2)}` }).map(ay => (
                          <option key={ay} value={ay}>{ay}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex justify-end gap-3 pt-1">
                      <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2 border border-[#D4D4D8] text-[#18181B] text-sm hover:bg-[#EBEBEB] transition-colors">Cancel</button>
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
                        editing={editingClassroom === classroom.id}
                        editForm={editForm} saving={saving}
                        addMemberEmailInput={addMemberEmailInput} addingMember={addingMember} memberError={memberError}
                        onExpand={() => handleExpand(classroom.id)}
                        onStartEdit={() => handleStartEdit(classroom)}
                        onCancelEdit={() => setEditingClassroom(null)}
                        onSaveEdit={() => handleSaveEdit(classroom.id)}
                        onEditFormChange={setEditForm}
                        onAddMemberEmailChange={v => { setAddMemberEmailInput(v); setMemberError('') }}
                        onAddMember={() => handleAddMember(classroom.id)}
                        onRemoveMember={uid => handleRemoveMember(classroom.id, uid)}
                        onDelete={() => handleDeleteClassroom(classroom.id, classroom.title)}
                        onToggleClose={() => handleToggleClose(classroom)}
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
                        editing={editingClassroom === classroom.id}
                        editForm={editForm} saving={saving}
                        addMemberEmailInput={addMemberEmailInput} addingMember={addingMember} memberError={memberError}
                        onExpand={() => handleExpand(classroom.id)}
                        onStartEdit={() => handleStartEdit(classroom)}
                        onCancelEdit={() => setEditingClassroom(null)}
                        onSaveEdit={() => handleSaveEdit(classroom.id)}
                        onEditFormChange={setEditForm}
                        onAddMemberEmailChange={v => { setAddMemberEmailInput(v); setMemberError('') }}
                        onAddMember={() => handleAddMember(classroom.id)}
                        onRemoveMember={uid => handleRemoveMember(classroom.id, uid)}
                        onDelete={() => handleDeleteClassroom(classroom.id, classroom.title)}
                        onToggleClose={() => handleToggleClose(classroom)}
                      />
                    ))}
                  </motion.div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
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
  editing: boolean; editForm: EditFormState; saving: boolean
  addMemberEmailInput: string; addingMember: string | null; memberError: string
  onExpand: () => void; onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: () => void
  onEditFormChange: (f: EditFormState) => void
  onAddMemberEmailChange: (v: string) => void; onAddMember: () => void
  onRemoveMember: (userId: string) => void; onDelete: () => void; onToggleClose: () => void
}

function ClassroomRow({
  classroom, closed, isAdmin, expanded, expandedDetails, editing, editForm, saving,
  addMemberEmailInput, addingMember, memberError,
  onExpand, onStartEdit, onCancelEdit, onSaveEdit, onEditFormChange,
  onAddMemberEmailChange, onAddMember, onRemoveMember, onDelete, onToggleClose,
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

              {/* Edit form */}
              {editing && isAdmin && (
                <div className="border border-[#D4D4D8] border-l-4 border-l-[#525252] bg-white rounded-xl p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#525252] flex items-center gap-2">
                    <Edit3 size={12} /> Edit Classroom
                    {closed && <span className="text-[#A1A1AA] font-normal normal-case">— closed, admin only</span>}
                  </h4>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Title</label>
                    <input type="text" value={editForm.title} onChange={e => onEditFormChange({ ...editForm, title: e.target.value })} className={aiSm} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Description</label>
                    <textarea value={editForm.description} onChange={e => onEditFormChange({ ...editForm, description: e.target.value })} className={`${aiSm} resize-none`} rows={2} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Academic Year</label>
                    <select value={editForm.academic_year} onChange={e => onEditFormChange({ ...editForm, academic_year: e.target.value })} className={aiSm}>
                      <option value="">Select year…</option>
                      {Array.from({ length: 21 }, (_, i) => { const y = 2020 + i; return `${y}-${String(y+1).slice(-2)}` }).map(ay => (
                        <option key={ay} value={ay}>{ay}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Grade</label>
                      <input type="number" value={editForm.grade} onChange={e => onEditFormChange({ ...editForm, grade: e.target.value })} className={aiSm} placeholder="10" min="1" max="12" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Section</label>
                      <input type="text" value={editForm.section} onChange={e => onEditFormChange({ ...editForm, section: e.target.value })} className={aiSm} placeholder="A" maxLength={5} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Subject</label>
                    <SubjectPicker value={editForm.subject} onChange={v => onEditFormChange({ ...editForm, subject: v })} size="sm" className="w-full" />
                  </div>
                  <div className="flex gap-2 justify-end pt-1">
                    <button onClick={onCancelEdit} className="px-4 py-1.5 text-sm border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB] transition-colors">Cancel</button>
                    <button onClick={onSaveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-1.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50">
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                    </button>
                  </div>
                </div>
              )}

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
