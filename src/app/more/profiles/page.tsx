'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import {
  UserPlus,
  Search,
  Edit3,
  Save,
  X,
  Loader2,
  Users,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Check,
  Trash2,
  Eye,
  Mail,
  Shield,
  Calendar,
} from 'lucide-react'
import {
  ProfileWithTeams,
  fetchAllProfiles,
  updateProfile,
  createNewUser,
  deleteUser,
  NewUserInput,
  ROLE_COLORS,
} from '@/lib/admin'
import { UserRole, getRoleDisplayName, getRoleBadgeColor } from '@/lib/supabase'
import { fetchMarksForStudent, StudentMarkWithContext } from '@/lib/classrooms'

const ROLE_LEFT_ACCENT: Record<string, string> = {
  admin:       'border-l-4 border-l-rose-400',
  principal:   'border-l-4 border-l-violet-400',
  coordinator: 'border-l-4 border-l-blue-400',
  teacher:     'border-l-4 border-l-teal-400',
  student:     'border-l-4 border-l-slate-300',
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
}

export default function ProfilesPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [profiles, setProfiles] = useState<ProfileWithTeams[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingProfile, setEditingProfile] = useState<string | null>(null)
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // View profile card state
  const [viewingProfile, setViewingProfile] = useState<ProfileWithTeams | null>(null)
  const [profileMarks, setProfileMarks] = useState<StudentMarkWithContext[]>([])
  const [loadingMarks, setLoadingMarks] = useState(false)

  useEffect(() => {
    if (!viewingProfile || viewingProfile.role !== 'student') {
      setProfileMarks([])
      return
    }
    setLoadingMarks(true)
    fetchMarksForStudent(viewingProfile.id).then(marks => {
      setProfileMarks(marks)
      setLoadingMarks(false)
    })
  }, [viewingProfile])

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState(false)

  // Create form state
  const [createForm, setCreateForm] = useState({
    email: '',
    full_name: '',
    role: 'student' as UserRole,
    grade: '',
    section: '',
  })

  // Edit state
  const [editForm, setEditForm] = useState({
    full_name: '',
    role: 'student' as UserRole,
    grade: '',
    section: '',
  })

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    const data = await fetchAllProfiles()
    setProfiles(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  const filteredProfiles = profiles.filter(p => {
    const q = searchQuery.toLowerCase()
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      p.role?.toLowerCase().includes(q)
    )
  })

  const handleStartEdit = (p: ProfileWithTeams) => {
    setEditingProfile(p.id)
    setEditForm({
      full_name: p.full_name || '',
      role: p.role,
      grade: p.grade?.toString() || '',
      section: p.section || '',
    })
  }

  const handleDeleteProfile = async (userId: string, name: string) => {
    if (!window.confirm(`Delete account for "${name}"? This cannot be undone.`)) return
    const result = await deleteUser(userId)
    if (result.success) {
      await loadProfiles()
    } else {
      alert('Failed to delete: ' + result.error)
    }
  }

  const handleSaveEdit = async (userId: string) => {
    setSaving(true)
    const result = await updateProfile(userId, {
      full_name: editForm.full_name.trim(),
      role: editForm.role,
      grade: editForm.grade ? parseInt(editForm.grade) : undefined,
      section: editForm.section || undefined,
    })
    if (!result.success && result.error) {
      alert(result.error)
      setSaving(false)
      return
    }
    setEditingProfile(null)
    await loadProfiles()
    setSaving(false)
  }

  const handleCreateProfile = async () => {
    setCreateError(null)
    setCreateSuccess(false)

    // Validation
    if (!createForm.email || !createForm.full_name) {
      setCreateError('Email and full name are required')
      return
    }

    if (!createForm.email.includes('@')) {
      setCreateError('Please enter a valid email address')
      return
    }

    setCreating(true)

    const input: NewUserInput = {
      email: createForm.email.trim(),
      full_name: createForm.full_name.trim(),
      role: createForm.role,
      grade: createForm.grade ? parseInt(createForm.grade) : undefined,
      section: createForm.section || undefined,
    }

    const result = await createNewUser(input)

    if (result.success) {
      setCreateSuccess(true)
      setCreateForm({
        email: '',
        full_name: '',
        role: 'student',
        grade: '',
        section: '',
      })
      await loadProfiles()

      // Close modal after 2 seconds
      setTimeout(() => {
        setShowCreateModal(false)
        setCreateSuccess(false)
      }, 2000)
    } else {
      setCreateError(result.error || 'Failed to create user')
    }

    setCreating(false)
  }

  // Group profiles by role
  const roleGroups = ['admin', 'principal', 'coordinator', 'teacher', 'student'] as UserRole[]

  // Role counts for banner stats
  const roleCounts = (roleGroups as string[]).reduce((acc, r) => {
    acc[r] = profiles.filter(p => p.role === r).length
    return acc
  }, {} as Record<string, number>)

  if (!user || !profile) return null

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="more">

        {/* ── Banner ── */}
        <div
          className="relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_65%)] pointer-events-none" />
          <div className="absolute -bottom-8 -right-8 opacity-[0.07] pointer-events-none select-none">
            <Users size={180} className="text-white" />
          </div>
          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-10">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="p-3 bg-white/20 backdrop-blur-sm rounded-2xl border border-white/20 flex-shrink-0">
                  <UserPlus size={24} className="text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">Profile Manager</h1>
                  <p className="hidden sm:block text-white/65 text-sm mt-0.5">
                    {!loading && profiles.length > 0
                      ? [
                          roleCounts['student']     && `${roleCounts['student']} students`,
                          roleCounts['teacher']     && `${roleCounts['teacher']} teachers`,
                          roleCounts['coordinator'] && `${roleCounts['coordinator']} coordinators`,
                          roleCounts['principal']   && `${roleCounts['principal']} principals`,
                          roleCounts['admin']       && `${roleCounts['admin']} admins`,
                        ].filter(Boolean).join(' · ')
                      : 'Create and manage user accounts'}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white text-sm font-semibold rounded-xl border border-white/25 transition-colors flex-shrink-0"
                >
                  <UserPlus size={16} />
                  <span className="hidden sm:inline">New Profile</span>
                  <span className="sm:hidden">New</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* Search */}
        <div className="mb-6 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="input-field pl-11"
            placeholder="Search by name, email, or role..."
          />
        </div>

        {/* Profiles List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="spinner mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading profiles...</p>
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
            <Users size={48} className="text-slate-300 mx-auto mb-4" />
            <h3 className="font-display text-xl font-bold text-slate-700 mb-2">No Profiles Found</h3>
            <p className="text-slate-500">
              {searchQuery ? 'Try a different search term.' : 'No profiles exist yet.'}
            </p>
          </div>
        ) : (
          <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-3">
            {filteredProfiles.map(p => (
              <motion.div key={p.id} variants={itemVariants} className={`bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow ${ROLE_LEFT_ACCENT[p.role] ?? ''}`}>
                {/* Profile Row */}
                <div
                  className="p-4 cursor-pointer hover:bg-slate-50/60 transition-colors"
                  onClick={() => setExpandedProfile(expandedProfile === p.id ? null : p.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4" onClick={e => editingProfile === p.id ? e.stopPropagation() : undefined}>
                      <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={44} />
                      <div>
                        {editingProfile === p.id ? (
                          <div className="space-y-2" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editForm.full_name}
                                onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                                className="input-field py-1 text-sm w-48"
                                placeholder="Full name"
                              />
                              <select
                                value={editForm.role}
                                onChange={e => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                                className="input-field py-1 text-sm w-36"
                              >
                                <option value="student">Student</option>
                                <option value="teacher">Teacher</option>
                                <option value="coordinator">Coordinator</option>
                                <option value="principal">Principal</option>
                                <option value="admin">Admin</option>
                              </select>
                            </div>
                            {(editForm.role === 'student') && (
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  value={editForm.grade}
                                  onChange={e => setEditForm({ ...editForm, grade: e.target.value })}
                                  className="input-field py-1 text-sm w-20"
                                  placeholder="Grade"
                                  min="1"
                                  max="12"
                                />
                                <input
                                  type="text"
                                  value={editForm.section}
                                  onChange={e => setEditForm({ ...editForm, section: e.target.value })}
                                  className="input-field py-1 text-sm w-20"
                                  placeholder="Section"
                                  maxLength={5}
                                />
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleSaveEdit(p.id)} disabled={saving} className="flex items-center gap-1 text-xs text-green-600 hover:bg-green-50 px-2 py-1 rounded">
                                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                Save
                              </button>
                              <button onClick={() => setEditingProfile(null)} className="flex items-center gap-1 text-xs text-slate-400 hover:bg-slate-100 px-2 py-1 rounded">
                                <X size={12} /> Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-slate-800">{p.full_name || 'No Name'}</p>
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${ROLE_COLORS[p.role]}`}>
                                {getRoleDisplayName(p.role)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500">{p.email}</p>
                            {p.role === 'student' && p.grade && (
                              <p className="text-xs text-slate-400">Grade {p.grade}{p.section ? `-${p.section}` : ''}</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Teams/Classrooms info */}
                      {p.teams.length > 0 && (
                        <span className="text-xs px-2 py-1 bg-purple-50 text-purple-600 rounded-full">
                          {p.teams.length} team{p.teams.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setViewingProfile(p) }}
                        className="p-2 text-slate-400 hover:text-mps-blue-600 hover:bg-mps-blue-50 rounded-lg transition-colors"
                        title="View profile card"
                      >
                        <Eye size={14} />
                      </button>
                      {isAdmin && editingProfile !== p.id && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); handleStartEdit(p) }}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit profile"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id, p.full_name || p.email) }}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete account"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                      <div className="p-2 text-slate-400">
                        {expandedProfile === p.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                <AnimatePresence>
                  {expandedProfile === p.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                        {p.teams.length > 0 && (
                          <div className="mb-3">
                            <h5 className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1">
                              <Users size={12} /> Teams
                            </h5>
                            <div className="flex flex-wrap gap-2">
                              {p.teams.map(t => (
                                <span key={t.id} className="text-xs px-2.5 py-1 bg-white rounded-lg border border-slate-200 text-slate-600">
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="text-xs text-slate-400">
                          <p>Created: {new Date(p.created_at).toLocaleDateString()}</p>
                          <p>ID: {p.id}</p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* View Profile Card Modal */}
        <AnimatePresence>
          {viewingProfile && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setViewingProfile(null)}
                className="fixed inset-0 bg-black/50 z-40"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                onClick={() => setViewingProfile(null)}
              >
                <div
                  className="w-full max-w-sm rounded-3xl overflow-y-auto shadow-2xl bg-white border border-slate-100 max-h-[85vh]"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Banner */}
                  <div
                    className="relative h-32 sticky top-0 z-10"
                    style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.15),transparent_70%)] pointer-events-none" />
                    <button
                      onClick={() => setViewingProfile(null)}
                      className="absolute top-3 right-3 p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Avatar + info */}
                  <div className="relative z-20 flex flex-col items-center -mt-12 pb-6 px-6">
                    <div
                      className="w-24 h-24 rounded-full ring-4 ring-white shadow-xl overflow-hidden flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
                    >
                      {viewingProfile.avatar_url ? (
                        <img src={viewingProfile.avatar_url} alt="Avatar" className="object-cover w-full h-full" />
                      ) : (
                        <span className="text-white text-3xl font-bold select-none">
                          {(viewingProfile.full_name || viewingProfile.email || 'U')
                            .split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                        </span>
                      )}
                    </div>

                    <h2 className="mt-2 font-display text-xl font-bold text-slate-800 text-center leading-tight">
                      {viewingProfile.full_name || 'No Name'}
                    </h2>
                    <div className="mt-1.5">
                      <span className={`text-xs px-3 py-1 rounded-full font-semibold ${getRoleBadgeColor(viewingProfile.role)}`}>
                        {getRoleDisplayName(viewingProfile.role)}
                      </span>
                    </div>

                    {viewingProfile.role === 'student' && viewingProfile.grade && (
                      <p className="mt-1 text-xs text-slate-400">
                        Grade {viewingProfile.grade}{viewingProfile.section ? `-${viewingProfile.section}` : ''}
                      </p>
                    )}

                    <div className="w-full mt-4 space-y-2">
                      <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                        <Mail size={15} className="text-mps-green-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Email</p>
                          <p className="font-medium text-slate-700 text-sm truncate">{viewingProfile.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                        <Shield size={15} className="text-purple-500 flex-shrink-0" />
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Role</p>
                          <p className="font-medium text-slate-700 text-sm">{getRoleDisplayName(viewingProfile.role)}</p>
                        </div>
                      </div>
                      {viewingProfile.created_at && (
                        <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                          <Calendar size={15} className="text-amber-500 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Member since</p>
                            <p className="font-medium text-slate-700 text-sm">
                              {new Date(viewingProfile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Assessment Marks — students only */}
                    {viewingProfile.role === 'student' && (
                      <div className="w-full mt-5">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Assessment Marks</p>
                        {loadingMarks ? (
                          <div className="flex items-center justify-center py-6 gap-2 text-sm text-slate-400">
                            <Loader2 size={14} className="animate-spin" /> Loading marks...
                          </div>
                        ) : profileMarks.length === 0 ? (
                          <p className="text-xs text-slate-400 text-center py-4">No assessment marks recorded</p>
                        ) : (() => {
                          // Group by academic year
                          const groups: Record<string, StudentMarkWithContext[]> = {}
                          for (const m of profileMarks) {
                            const ay = m.classroom_start_date
                              ? `AY ${parseInt(m.classroom_start_date.split('-')[0])}-${String(parseInt(m.classroom_start_date.split('-')[0]) + 1).slice(-2)}`
                              : 'No Year'
                            if (!groups[ay]) groups[ay] = []
                            groups[ay].push(m)
                          }
                          return Object.entries(groups).map(([year, marks]) => (
                            <div key={year} className="mb-4">
                              <p className="text-[11px] font-bold mb-2 flex items-center gap-1" style={{ color: 'var(--page-primary)' }}>
                                <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--page-primary)' }} />
                                {year}
                              </p>
                              {/* Group by classroom within this year */}
                              {(() => {
                                const byClass: Record<string, StudentMarkWithContext[]> = {}
                                for (const m of marks) {
                                  if (!byClass[m.classroom_title]) byClass[m.classroom_title] = []
                                  byClass[m.classroom_title].push(m)
                                }
                                return Object.entries(byClass).map(([cls, clsMarks]) => (
                                  <div key={cls} className="mb-2 bg-slate-50 rounded-xl p-3">
                                    <p className="text-xs font-semibold text-slate-600 mb-2 truncate">{cls}</p>
                                    <div className="space-y-1.5">
                                      {clsMarks.map((m, i) => (
                                        <div key={i} className="flex items-center justify-between gap-2">
                                          <p className="text-xs text-slate-600 truncate flex-1">{m.assessment_title}</p>
                                          <div className="flex items-center gap-1.5 flex-shrink-0">
                                            <span className={`text-xs font-bold ${m.marks === null ? 'text-slate-400' : m.marks / m.max_marks >= 0.75 ? 'text-green-600' : m.marks / m.max_marks >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>
                                              {m.marks ?? '—'}
                                            </span>
                                            <span className="text-[10px] text-slate-400">/ {m.max_marks}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))
                              })()}
                            </div>
                          ))
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Create Profile Modal */}
        <AnimatePresence>
          {showCreateModal && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowCreateModal(false)}
                className="fixed inset-0 bg-black/50 z-40"
              />

              {/* Modal */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
              >
                <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                  {/* Modal header */}
                  <div
                    className="px-6 py-4 flex items-center justify-between"
                    style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white/20 rounded-xl">
                        <UserPlus size={18} className="text-white" />
                      </div>
                      <h2 className="font-display text-lg font-bold text-white">Create New Profile</h2>
                    </div>
                    <button
                      onClick={() => setShowCreateModal(false)}
                      className="p-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                    >
                      <X size={18} className="text-white" />
                    </button>
                  </div>
                  <div className="p-6">

                  {createSuccess ? (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Check size={32} className="text-green-600" />
                      </div>
                      <h3 className="font-bold text-lg text-slate-800 mb-2">Profile Created!</h3>
                      <p className="text-sm text-slate-600">
                        Password reset email sent to {createForm.email}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {createError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                          {createError}
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Email Address *
                        </label>
                        <input
                          type="email"
                          value={createForm.email}
                          onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                          className="input-field"
                          placeholder="user@example.com"
                          disabled={creating}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Full Name *
                        </label>
                        <input
                          type="text"
                          value={createForm.full_name}
                          onChange={e => setCreateForm({ ...createForm, full_name: e.target.value })}
                          className="input-field"
                          placeholder="John Doe"
                          disabled={creating}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Role *
                        </label>
                        <select
                          value={createForm.role}
                          onChange={e => setCreateForm({ ...createForm, role: e.target.value as UserRole })}
                          className="input-field"
                          disabled={creating}
                        >
                          <option value="student">Student</option>
                          <option value="teacher">Teacher</option>
                          <option value="coordinator">Coordinator</option>
                          <option value="principal">Principal</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>

                      {createForm.role === 'student' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                              Grade
                            </label>
                            <select
                              value={createForm.grade}
                              onChange={e => setCreateForm({ ...createForm, grade: e.target.value })}
                              className="input-field"
                              disabled={creating}
                            >
                              <option value="">Select grade...</option>
                              {Array.from({ length: 12 }, (_, i) => i + 1).map(grade => (
                                <option key={grade} value={grade}>
                                  Grade {grade}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                              Section
                            </label>
                            <select
                              value={createForm.section}
                              onChange={e => setCreateForm({ ...createForm, section: e.target.value })}
                              className="input-field"
                              disabled={creating}
                            >
                              <option value="">Select section...</option>
                              {['A', 'B', 'C', 'D', 'E', 'F'].map(section => (
                                <option key={section} value={section}>
                                  Section {section}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}

                      <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-lg text-sm text-blue-700">
                        <p className="font-medium mb-1">Password Reset</p>
                        <p>A password reset email will be sent to the user's email address.</p>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={() => setShowCreateModal(false)}
                          className="btn-secondary flex-1"
                          disabled={creating}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateProfile}
                          className="btn-primary flex-1 flex items-center justify-center gap-2"
                          disabled={creating}
                        >
                          {creating ? (
                            <>
                              <Loader2 size={18} className="animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <UserPlus size={18} />
                              Create Profile
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                  </div>{/* end p-6 */}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
        </div>{/* end body */}
      </div>{/* end data-page-theme */}
    </ProtectedLayout>
  )
}
