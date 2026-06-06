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
  removeClassroomMember,
  deleteClassroom,
  isClassroomClosed,
} from '@/lib/classrooms'
import { supabase } from '@/lib/supabase'

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
}

export default function ClassroomManagerPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const router = useRouter()

  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [expandedClassroom, setExpandedClassroom] = useState<string | null>(null)
  const [expandedDetails, setExpandedDetails] = useState<ClassroomWithDetails | null>(null)

  // Create form state
  const [newClassroom, setNewClassroom] = useState({
    title: '',
    description: '',
    grade: '',
    section: '',
    subject: '',
    academic_year: '',
    coordinator_email: '',
    teacher_email: '',
  })
  const [creating, setCreating] = useState(false)

  // Edit state
  const [editingClassroom, setEditingClassroom] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    academic_year: '',
    grade: '',
    section: '',
    subject: '',
  })
  const [saving, setSaving] = useState(false)

  // Add member
  const [addMemberEmailInput, setAddMemberEmailInput] = useState('')
  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [memberError, setMemberError] = useState('')

  // Search
  const [classroomSearch, setClassroomSearch] = useState('')

  // Academic year helpers
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

  // Load all classrooms (active + closed) for manager
  const loadClassrooms = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    const data = await fetchClassroomsForUser(user.id, profile.role, true)
    setClassrooms(data)
    setLoading(false)
  }, [user, profile])

  useEffect(() => {
    loadClassrooms()
  }, [loadClassrooms])

  const loadClassroomDetails = async (classroomId: string) => {
    const details = await fetchClassroomById(classroomId)
    if (details) {
      setExpandedDetails(details)
    }
  }

  const handleToggleClose = async (classroom: ClassroomWithDetails) => {
    if (isClassroomClosed(classroom)) {
      // Reopen: restore end_date from academic year (start_date + 1 year) or null
      const reopenEnd = classroom.start_date
        ? `${parseInt(classroom.start_date.split('-')[0]) + 1}-03-31`
        : null
      await updateClassroom(classroom.id, { end_date: reopenEnd })
    } else {
      // Close: set end_date to yesterday
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      await updateClassroom(classroom.id, { end_date: yesterday.toISOString().split('T')[0] })
    }
    await loadClassrooms()
  }

  const handleExpand = async (classroomId: string) => {
    if (expandedClassroom === classroomId) {
      setExpandedClassroom(null)
      setExpandedDetails(null)
      setEditingClassroom(null)
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
      start_date,
      end_date,
    })
    if (ok) {
      setEditingClassroom(null)
      await loadClassrooms()
      if (expandedClassroom === classroomId) {
        await loadClassroomDetails(classroomId)
      }
    }
    setSaving(false)
  }

  const handleCreateClassroom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newClassroom.title.trim() || !user || !profile) return
    setCreating(true)

    // Resolve coordinator — only coordinator/principal/admin are eligible
    let coordinatorId: string | undefined
    if (newClassroom.coordinator_email.trim()) {
      const { data: coordProfile } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('email', newClassroom.coordinator_email.trim().toLowerCase())
        .in('role', ['coordinator', 'principal', 'admin'])
        .single()
      if (coordProfile) {
        coordinatorId = coordProfile.id
      } else {
        setCreating(false)
        alert('Coordinator email not found or user does not have a coordinator/principal/admin role.')
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
      // Add teacher by email if provided
      if (newClassroom.teacher_email.trim()) {
        await addMemberByEmail(result.id, newClassroom.teacher_email.trim())
      }

      // Auto-add all principals and admins as members using their actual role
      const { data: defaultMembers } = await supabase
        .from('profiles')
        .select('id, role')
        .in('role', ['principal', 'admin'])

      for (const member of defaultMembers ?? []) {
        if (member.id === user.id) continue // creator already added
        if (member.id === coordinatorId) continue // coordinator already added
        const { error } = await supabase
          .from('classroom_members')
          .insert({ classroom_id: result.id, user_id: member.id, role: member.role })
        if (error && error.code !== '23505') {
          console.error('Failed to add default member:', error.message)
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
    setAddingMember(classroomId)
    setMemberError('')

    const result = await addMemberByEmail(classroomId, addMemberEmailInput.trim())
    if (result.success) {
      setAddMemberEmailInput('')
      await loadClassroomDetails(classroomId)
    } else {
      setMemberError(result.error || 'Failed to add member')
    }
    setAddingMember(null)
  }

  const handleRemoveMember = async (classroomId: string, userId: string, memberRole: string) => {
    await removeClassroomMember(classroomId, userId)
    await loadClassroomDetails(classroomId)
  }

  const handleDeleteClassroom = async (classroomId: string, title: string) => {
    if (!window.confirm(`Delete classroom "${title}"? This cannot be undone.`)) return
    const ok = await deleteClassroom(classroomId)
    if (ok) {
      if (expandedClassroom === classroomId) {
        setExpandedClassroom(null)
        setExpandedDetails(null)
      }
      await loadClassrooms()
    }
  }

  if (!user || !profile) return null

  // Filter + split classrooms
  const searchLower = classroomSearch.trim().toLowerCase()
  const filteredClassrooms = searchLower
    ? classrooms.filter(c =>
        c.title.toLowerCase().includes(searchLower) ||
        (c.description && c.description.toLowerCase().includes(searchLower))
      )
    : classrooms
  const activeClassrooms = filteredClassrooms.filter(c => !isClassroomClosed(c))
  const closedClassrooms = filteredClassrooms.filter(c => isClassroomClosed(c))

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="more">

        <PageBanner
          settingKey="classrooms_banner"
          defaultBanner={CLASSROOMS_BANNER_DEFAULT}
          icon={<BookOpen size={26} className="text-white" />}
          title="Classroom Management"
          subtitle={
            !loading && classrooms.length > 0
              ? `${activeClassrooms.length} active · ${closedClassrooms.length} closed`
              : 'Create and manage classrooms'
          }
          isAdmin={isAdmin}
          onBack={() => router.back()}
          maxWidth="max-w-4xl"
          actions={isAdmin ? (
            <>
              <button
                onClick={() => setShowCreateForm(v => !v)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-medium text-sm rounded-xl border border-white/30 transition-colors"
              >
                {showCreateForm ? <X size={15} /> : <Plus size={15} />}
                {showCreateForm ? 'Cancel' : 'New Classroom'}
              </button>
              <button
                onClick={() => setShowCreateForm(v => !v)}
                className="sm:hidden w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center text-white transition-colors"
              >
                {showCreateForm ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          ) : undefined}
        />

        {/* ── Body ── */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

        {/* Search Bar */}
        {!loading && classrooms.length > 0 && (
          <div className="mb-6 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={classroomSearch}
              onChange={e => setClassroomSearch(e.target.value)}
              className="input-field pl-9 py-2.5 text-sm bg-white"
              placeholder="Search classrooms by title or description…"
            />
            {classroomSearch && (
              <button
                onClick={() => setClassroomSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Create Form */}
        <AnimatePresence>
          {showCreateForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 overflow-hidden"
            >
              <form onSubmit={handleCreateClassroom} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display text-lg font-bold text-slate-800">New Classroom</h3>
                  <button type="button" onClick={() => setShowCreateForm(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                    <X size={20} className="text-slate-400" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                    <input
                      type="text"
                      value={newClassroom.title}
                      onChange={e => setNewClassroom({ ...newClassroom, title: e.target.value })}
                      className="input-field"
                      placeholder="e.g., Class 10-A Science"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Grade</label>
                      <input
                        type="number"
                        value={newClassroom.grade}
                        onChange={e => setNewClassroom({ ...newClassroom, grade: e.target.value })}
                        className="input-field"
                        placeholder="10"
                        min="1"
                        max="12"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Section</label>
                      <input
                        type="text"
                        value={newClassroom.section}
                        onChange={e => setNewClassroom({ ...newClassroom, section: e.target.value })}
                        className="input-field"
                        placeholder="A"
                        maxLength={5}
                      />
                    </div>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <textarea
                    value={newClassroom.description}
                    onChange={e => setNewClassroom({ ...newClassroom, description: e.target.value })}
                    className="input-field resize-none"
                    rows={2}
                    placeholder="Brief description..."
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                  <SubjectPicker
                    value={newClassroom.subject}
                    onChange={v => setNewClassroom({ ...newClassroom, subject: v })}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Coordinator Email</label>
                    <UserEmailSuggest
                      value={newClassroom.coordinator_email}
                      onChange={v => setNewClassroom({ ...newClassroom, coordinator_email: v })}
                      roles={['coordinator', 'principal', 'admin']}
                      placeholder="coordinator@school.com"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Teacher Email</label>
                    <UserEmailSuggest
                      value={newClassroom.teacher_email}
                      onChange={v => setNewClassroom({ ...newClassroom, teacher_email: v })}
                      roles={['teacher', 'coordinator', 'principal', 'admin']}
                      placeholder="teacher@school.com"
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Academic Year</label>
                  <select
                    value={newClassroom.academic_year}
                    onChange={e => setNewClassroom({ ...newClassroom, academic_year: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select academic year...</option>
                    {Array.from({ length: 21 }, (_, i) => { const y = 2020 + i; return `${y}-${String(y+1).slice(-2)}` }).map(ay => (
                      <option key={ay} value={ay}>{ay}</option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setShowCreateForm(false)} className="btn-ghost">Cancel</button>
                  <button type="submit" disabled={creating} className="btn-primary flex items-center gap-2">
                    {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    Create Classroom
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Classrooms List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="spinner mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading classrooms...</p>
          </div>
        ) : classrooms.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
            <BookOpen size={48} className="text-slate-300 mx-auto mb-4" />
            <h3 className="font-display text-xl font-bold text-slate-700 mb-2">No Classrooms Yet</h3>
            <p className="text-slate-500 mb-6">Create your first classroom to get started.</p>
            {isAdmin && (
              <button onClick={() => setShowCreateForm(true)} className="btn-primary">
                <Plus size={16} className="inline mr-1" /> Create Classroom
              </button>
            )}
          </div>
        ) : filteredClassrooms.length === 0 && classroomSearch ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
            <Search size={36} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No classrooms match &ldquo;{classroomSearch}&rdquo;</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Active Classrooms */}
            {activeClassrooms.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active</span>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full">{activeClassrooms.length}</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-4">
                  {activeClassrooms.map(classroom => (
                    <ClassroomCard
                      key={classroom.id}
                      classroom={classroom}
                      closed={false}
                      isAdmin={isAdmin}
                      expanded={expandedClassroom === classroom.id}
                      expandedDetails={expandedClassroom === classroom.id ? expandedDetails : null}
                      editing={editingClassroom === classroom.id}
                      editForm={editForm}
                      saving={saving}
                      addMemberEmailInput={addMemberEmailInput}
                      addingMember={addingMember}
                      memberError={memberError}
                      onExpand={() => handleExpand(classroom.id)}
                      onStartEdit={() => handleStartEdit(classroom)}
                      onCancelEdit={() => setEditingClassroom(null)}
                      onSaveEdit={() => handleSaveEdit(classroom.id)}
                      onEditFormChange={setEditForm}
                      onAddMemberEmailChange={(v) => { setAddMemberEmailInput(v); setMemberError('') }}
                      onAddMember={() => handleAddMember(classroom.id)}
                      onRemoveMember={(uid, role) => handleRemoveMember(classroom.id, uid, role)}
                      onDelete={() => handleDeleteClassroom(classroom.id, classroom.title)}
                      onToggleClose={() => handleToggleClose(classroom)}
                    />
                  ))}
                </motion.div>
              </div>
            )}

            {/* Closed Classrooms */}
            {closedClassrooms.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Closed</span>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-xs font-semibold rounded-full">{closedClassrooms.length}</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-4">
                  {closedClassrooms.map(classroom => (
                    <ClassroomCard
                      key={classroom.id}
                      classroom={classroom}
                      closed={true}
                      isAdmin={isAdmin}
                      expanded={expandedClassroom === classroom.id}
                      expandedDetails={expandedClassroom === classroom.id ? expandedDetails : null}
                      editing={editingClassroom === classroom.id}
                      editForm={editForm}
                      saving={saving}
                      addMemberEmailInput={addMemberEmailInput}
                      addingMember={addingMember}
                      memberError={memberError}
                      onExpand={() => handleExpand(classroom.id)}
                      onStartEdit={() => handleStartEdit(classroom)}
                      onCancelEdit={() => setEditingClassroom(null)}
                      onSaveEdit={() => handleSaveEdit(classroom.id)}
                      onEditFormChange={setEditForm}
                      onAddMemberEmailChange={(v) => { setAddMemberEmailInput(v); setMemberError('') }}
                      onAddMember={() => handleAddMember(classroom.id)}
                      onRemoveMember={(uid, role) => handleRemoveMember(classroom.id, uid, role)}
                      onDelete={() => handleDeleteClassroom(classroom.id, classroom.title)}
                      onToggleClose={() => handleToggleClose(classroom)}
                    />
                  ))}
                </motion.div>
              </div>
            )}
          </div>
        )}
        </div>{/* end body */}
      </div>{/* end data-page-theme */}
    </ProtectedLayout>
  )
}

// --- Helpers ---

const AVATAR_GRADIENTS = [
  'from-blue-400 to-indigo-500',
  'from-violet-500 to-purple-600',
  'from-cyan-400 to-teal-500',
  'from-rose-400 to-pink-500',
  'from-amber-400 to-orange-500',
  'from-emerald-400 to-green-500',
  'from-sky-400 to-blue-500',
  'from-fuchsia-400 to-purple-500',
]

function classroomGradient(title: string): string {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) & 0xff
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

const ROLE_BADGE: Record<string, string> = {
  admin:       'bg-rose-100 text-rose-700',
  principal:   'bg-purple-100 text-purple-700',
  coordinator: 'bg-blue-100 text-blue-700',
  teacher:     'bg-teal-100 text-teal-700',
  student:     'bg-slate-100 text-slate-600',
}

// --- ClassroomCard sub-component ---

interface EditFormState {
  title: string
  description: string
  academic_year: string
  grade: string
  section: string
  subject: string
}

interface ClassroomCardProps {
  classroom: ClassroomWithDetails
  closed: boolean
  isAdmin: boolean
  expanded: boolean
  expandedDetails: ClassroomWithDetails | null
  editing: boolean
  editForm: EditFormState
  saving: boolean
  addMemberEmailInput: string
  addingMember: string | null
  memberError: string
  onExpand: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onEditFormChange: (form: EditFormState) => void
  onAddMemberEmailChange: (v: string) => void
  onAddMember: () => void
  onRemoveMember: (userId: string, role: string) => void
  onDelete: () => void
  onToggleClose: () => void
}

function ClassroomCard({
  classroom,
  closed,
  isAdmin,
  expanded,
  expandedDetails,
  editing,
  editForm,
  saving,
  addMemberEmailInput,
  addingMember,
  memberError,
  onExpand,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditFormChange,
  onAddMemberEmailChange,
  onAddMember,
  onRemoveMember,
  onDelete,
  onToggleClose,
}: ClassroomCardProps) {
  const [showMembers, setShowMembers] = useState(false)
  const grad = classroomGradient(classroom.title)
  return (
    <motion.div
      variants={itemVariants}
      className={`bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow ${closed ? 'opacity-70' : ''}`}
    >
      {/* Header */}
      <div
        className="p-5 cursor-pointer hover:bg-slate-50/60 transition-colors"
        onClick={onExpand}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md flex-shrink-0 bg-gradient-to-br ${closed ? 'from-slate-300 to-slate-400' : grad}`}>
              {closed ? <Lock size={18} /> : classroom.title.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg font-bold text-slate-800">{classroom.title}</h3>
                {closed && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-medium">Closed</span>
                )}
              </div>
              {classroom.description && (
                <p className="hidden sm:block text-sm text-slate-500">{classroom.description}</p>
              )}
              <div className="flex items-center gap-3 mt-1">
                <button
                  onClick={e => {
                    e.stopPropagation()
                    if (!expanded) onExpand()
                    setShowMembers(true)
                  }}
                  className="text-xs text-slate-500 flex items-center gap-1 hover:text-mps-blue-600 transition-colors underline-offset-2 hover:underline cursor-pointer"
                >
                  <Users size={12} /> {classroom.member_count || 0} members
                </button>
                {classroom.start_date && (
                  <span className="hidden sm:flex text-xs text-slate-400 items-center gap-1">
                    <Calendar size={12} />
                    {`AY ${parseInt(classroom.start_date.split('-')[0])}-${String(parseInt(classroom.start_date.split('-')[0]) + 1).slice(-2)}`}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={`/classrooms/${classroom.id}`}
              onClick={e => e.stopPropagation()}
              className="p-1.5 text-slate-400 hover:text-mps-blue-600 hover:bg-mps-blue-50 rounded-lg transition-colors"
              title="View classroom"
            >
              <ExternalLink size={15} />
            </Link>
            {isAdmin && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); onToggleClose() }}
                  className={`p-1.5 rounded-lg transition-colors ${closed ? 'text-green-600 hover:bg-green-50' : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'}`}
                  title={closed ? 'Reopen classroom' : 'Close classroom'}
                >
                  {closed ? <Lock size={15} /> : <LockOpen size={15} />}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onStartEdit() }}
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Edit classroom"
                >
                  <Edit3 size={15} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDelete() }}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Delete classroom"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
            {expanded
              ? <ChevronUp size={20} className="text-slate-400" />
              : <ChevronDown size={20} className="text-slate-400" />
            }
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-100 bg-slate-50/50 p-5">
              {/* Edit Form */}
              {editing && isAdmin && (
                <div className="mb-5 p-4 bg-blue-50/60 rounded-xl border border-blue-100">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <Edit3 size={14} /> Edit Classroom
                    {closed && <span className="text-xs font-normal text-amber-600">(Closed — admin only)</span>}
                  </h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={e => onEditFormChange({ ...editForm, title: e.target.value })}
                        className="input-field text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                      <textarea
                        value={editForm.description}
                        onChange={e => onEditFormChange({ ...editForm, description: e.target.value })}
                        className="input-field text-sm resize-none"
                        rows={2}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Academic Year</label>
                      <select
                        value={editForm.academic_year}
                        onChange={e => onEditFormChange({ ...editForm, academic_year: e.target.value })}
                        className="input-field text-sm"
                      >
                        <option value="">Select year...</option>
                        {Array.from({ length: 21 }, (_, i) => { const y = 2020 + i; return `${y}-${String(y+1).slice(-2)}` }).map(ay => (
                          <option key={ay} value={ay}>{ay}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Grade <span className="text-slate-400 font-normal">(optional)</span></label>
                        <input
                          type="number"
                          value={editForm.grade}
                          onChange={e => onEditFormChange({ ...editForm, grade: e.target.value })}
                          className="input-field text-sm"
                          placeholder="10"
                          min="1"
                          max="12"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Section <span className="text-slate-400 font-normal">(optional)</span></label>
                        <input
                          type="text"
                          value={editForm.section}
                          onChange={e => onEditFormChange({ ...editForm, section: e.target.value })}
                          className="input-field text-sm"
                          placeholder="A"
                          maxLength={5}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Subject <span className="text-slate-400 font-normal">(optional)</span></label>
                      <SubjectPicker
                        value={editForm.subject}
                        onChange={v => onEditFormChange({ ...editForm, subject: v })}
                      />
                    </div>
                    <div className="flex gap-2 justify-end pt-1">
                      <button onClick={onCancelEdit} className="btn-ghost text-sm py-1.5">Cancel</button>
                      <button
                        onClick={onSaveEdit}
                        disabled={saving}
                        className="btn-primary text-sm py-1.5 flex items-center gap-1.5"
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Add Member — above member list, only for active classrooms */}
              {isAdmin && (!closed) && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <UserEmailSuggest
                      value={addMemberEmailInput}
                      onChange={v => onAddMemberEmailChange(v)}
                      placeholder="Add member by email…"
                      className="input-field py-2 text-sm w-full"
                    />
                  </div>
                  <button
                    onClick={onAddMember}
                    disabled={addingMember === classroom.id}
                    className="btn-primary py-2 text-sm flex-shrink-0"
                  >
                    {addingMember === classroom.id ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
                  </button>
                </div>
              )}
              {memberError && (
                <p className="text-xs text-rose-500 mb-2">{memberError}</p>
              )}

              {/* Members */}
              <button
                type="button"
                onClick={() => setShowMembers(v => !v)}
                className="w-full flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors mb-2"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Users size={14} className="text-slate-400" />
                  Members
                  {expandedDetails && (
                    <span className="text-xs font-normal text-slate-400">({expandedDetails.members.length})</span>
                  )}
                </span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${showMembers ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {showMembers && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="max-h-[520px] overflow-y-auto space-y-2 mb-4 pt-1 pr-0.5">
                      {!expandedDetails ? (
                        <div className="flex items-center gap-2 text-sm text-slate-400 px-3">
                          <Loader2 size={14} className="animate-spin" /> Loading members...
                        </div>
                      ) : expandedDetails.members.length === 0 ? (
                        <p className="text-sm text-slate-500 px-3">No members yet</p>
                      ) : (
                        expandedDetails.members.map(member => (
                          <div key={member.id} className="flex items-center justify-between py-2 px-3 rounded-xl bg-white border border-slate-100">
                            <div className="flex items-center gap-3">
                              <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={32} userId={member.user?.id} />
                              <div>
                                <p className="text-sm font-medium text-slate-700">{member.user?.full_name || 'Unknown'}</p>
                                <p className="text-xs text-slate-500">{member.user?.email}</p>
                              </div>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${ROLE_BADGE[member.role] ?? 'bg-slate-100 text-slate-600'}`}>{member.role}</span>
                            </div>
                            {isAdmin && !closed && (
                              <button
                                onClick={() => onRemoveMember(member.user_id, member.role)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Remove member"
                              >
                                <UserMinus size={14} />
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
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-2">
                  <Lock size={12} /> This classroom is closed. Contact an admin to make changes.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
