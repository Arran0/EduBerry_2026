'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import {
  UserPlus,
  Search,
  Edit3,
  Save,
  X,
  Loader2,
  Users,
  ChevronDown,
  ChevronUp,
  Check,
  Trash2,
  Eye,
  Mail,
  Shield,
  Calendar,
  Plus,
  FileSpreadsheet,
  Ban,
  ShieldCheck,
} from 'lucide-react'
import { PROFILES_BANNER_DEFAULT, AnnouncementBannerConfig } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
const BulkImportModal = dynamic(() => import('@/components/BulkImportModal'))
import {
  ProfileWithTeams,
  fetchAllProfiles,
  updateProfile,
  createNewUser,
  deleteUser,
  toggleBan,
  NewUserInput,
} from '@/lib/admin'
import { UserRole, getRoleDisplayName } from '@/lib/supabase'
import { fetchMarksForStudent, StudentMarkWithContext } from '@/lib/classrooms'

const ROLE_BAR: Record<string, string> = {
  admin:       'bg-rose-500',
  principal:   'bg-violet-500',
  coordinator: 'bg-blue-500',
  teacher:     'bg-teal-500',
  student:     'bg-[#71717A]',
  driver:      'bg-orange-500',
}

const ROLE_BADGE: Record<string, string> = {
  admin:       'bg-rose-50 text-rose-700 border-rose-200',
  principal:   'bg-violet-50 text-violet-700 border-violet-200',
  coordinator: 'bg-blue-50 text-blue-700 border-blue-200',
  teacher:     'bg-teal-50 text-teal-700 border-teal-200',
  student:     'bg-[#F4F4F5] text-[#52525B] border-[#D4D4D8]',
  driver:      'bg-orange-50 text-orange-700 border-orange-200',
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.025 } },
}

const itemVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
}

export default function ProfilesPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const router = useRouter()

  const [profiles, setProfiles] = useState<ProfileWithTeams[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingProfile, setEditingProfile] = useState<string | null>(null)
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)

  const [viewingProfile, setViewingProfile] = useState<ProfileWithTeams | null>(null)
  const [profileMarks, setProfileMarks] = useState<StudentMarkWithContext[]>([])
  const [loadingMarks, setLoadingMarks] = useState(false)

  const [pageBannerCfg, setPageBannerCfg] = useState<AnnouncementBannerConfig>(PROFILES_BANNER_DEFAULT)
  const [bannerEditing, setBannerEditing] = useState(false)

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

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState(false)
  const [createAutoConfirm, setCreateAutoConfirm] = useState(false)
  const [createAutoConfirmPassword, setCreateAutoConfirmPassword] = useState('mps2627')
  const [createdAutoConfirm, setCreatedAutoConfirm] = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')

  const [createForm, setCreateForm] = useState({
    email: '',
    full_name: '',
    role: 'student' as UserRole,
    grade: '',
    section: '',
  })

  const [editForm, setEditForm] = useState({
    full_name: '',
    role: 'student' as UserRole,
    grade: '',
    section: '',
  })

  // Smart boards are kiosk logins: default them to "set password & activate"
  // since an invite-email flow doesn't fit a shared board account.
  useEffect(() => {
    if (createForm.role === 'smartboard') setCreateAutoConfirm(true)
  }, [createForm.role])

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

  const handleToggleBan = async (userId: string, name: string, currentlyBanned: boolean) => {
    const action = currentlyBanned ? 'unban' : 'ban'
    const msg = currentlyBanned
      ? `Restore access for "${name}"?`
      : `Ban "${name}"? They will immediately lose the ability to sign in.`
    if (!window.confirm(msg)) return
    const result = await toggleBan(userId, !currentlyBanned)
    if (result.success) {
      await loadProfiles()
    } else {
      alert(`Failed to ${action}: ` + result.error)
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
    if (!createForm.email || !createForm.full_name) {
      setCreateError('Email and full name are required')
      return
    }
    if (!createForm.email.includes('@')) {
      setCreateError('Please enter a valid email address')
      return
    }
    if (createAutoConfirm && createAutoConfirmPassword.length < 6) {
      setCreateError('Password must be at least 6 characters')
      return
    }
    setCreating(true)
    const input: NewUserInput = {
      email: createForm.email.trim(),
      full_name: createForm.full_name.trim(),
      role: createForm.role,
      grade: createForm.grade ? parseInt(createForm.grade) : undefined,
      section: createForm.section || undefined,
      autoConfirm: createAutoConfirm,
      password: createAutoConfirm ? createAutoConfirmPassword : undefined,
    }
    const result = await createNewUser(input)
    if (result.success) {
      setCreatedAutoConfirm(!!result.autoConfirm)
      setCreatedEmail(createForm.email.trim())
      setCreateSuccess(true)
      setCreateForm({ email: '', full_name: '', role: 'student', grade: '', section: '' })
      await loadProfiles()
      setTimeout(() => {
        setShowCreateModal(false)
        setCreateSuccess(false)
        setCreatedAutoConfirm(false)
        setCreatedEmail('')
      }, 3000)
    } else {
      setCreateError(result.error || 'Failed to create user')
    }
    setCreating(false)
  }

  if (!user || !profile) return null

  const adminInput = 'border border-[#D4D4D8] bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-md'
  const adminInputMd = 'border border-[#D4D4D8] bg-white px-4 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg'
  const adminSelect = 'border border-[#D4D4D8] bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors rounded-md'

  const bannerGradient = pageBannerCfg.imageUrl
    ? undefined
    : `linear-gradient(140deg, ${pageBannerCfg.gradFrom} 0%, ${pageBannerCfg.gradTo} 100%)`

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ backgroundColor: '#FDFCF9', minHeight: '100vh' }}>
        <PageBanner
          settingKey="profiles_banner"
          defaultBanner={PROFILES_BANNER_DEFAULT}
          icon={<UserPlus size={26} className="text-white" />}
          title="Profile Manager"
          subtitle="Create and manage user accounts"
          isAdmin={isAdmin}
          onBack={() => router.back()}
          maxWidth="max-w-7xl"
          onBannerChange={setPageBannerCfg}
          onEditingChange={setBannerEditing}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/70 hidden sm:block">{profiles.length} users</span>
              <button
                onClick={() => setShowBulkImport(true)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium border border-white/20 rounded-lg transition-colors"
              >
                <FileSpreadsheet size={15} />
                Import CSV
              </button>
              <button
                onClick={() => setShowBulkImport(true)}
                className="sm:hidden w-10 h-10 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg flex items-center justify-center text-white transition-colors"
                title="Import CSV"
              >
                <FileSpreadsheet size={18} />
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white text-sm font-medium border border-white/25 rounded-lg backdrop-blur-sm transition-colors"
              >
                <Plus size={15} />
                Create Profile
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="sm:hidden w-10 h-10 bg-white/15 hover:bg-white/25 border border-white/25 rounded-lg flex items-center justify-center text-white backdrop-blur-sm transition-colors"
              >
                <Plus size={18} />
              </button>
            </div>
          }
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">

          {/* Fading content: dims (not hidden) while banner is being edited */}
          <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.3s ease, filter 0.3s ease' }}>

            {/* Search — half overlaps the banner */}
            <div className="mb-4 relative z-10" style={{ marginTop: '-22px' }}>
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full border border-[#E4E4E7] bg-white pl-10 pr-9 py-3 text-sm focus:outline-none focus:border-[#27272A] transition-colors placeholder:text-[#A1A1AA] rounded-xl shadow-lg"
                placeholder="Search by name, email, or role…"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A] p-0.5 rounded">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Table */}
            {loading ? (
              <div className="border border-[#E4E4E7] bg-white rounded-xl py-16 text-center">
                <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A1A1AA]" />
                <p className="text-sm text-[#71717A]">Loading profiles…</p>
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="border border-[#E4E4E7] bg-white rounded-xl p-12 text-center">
                <Users size={36} className="text-[#D4D4D8] mx-auto mb-3" />
                <p className="text-sm font-semibold text-[#18181B] mb-1">No Profiles Found</p>
                <p className="text-sm text-[#71717A]">
                  {searchQuery ? 'Try a different search term.' : 'No profiles exist yet.'}
                </p>
              </div>
            ) : (
              <div className="border border-[#E4E4E7] overflow-hidden rounded-xl">
                {/* Column headers */}
                <div className="bg-[#27272A] pl-1 pr-4 py-2.5 hidden sm:flex items-center gap-3">
                  <span className="w-9 flex-shrink-0" />
                  <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Name / Email</span>
                  <span className="w-28 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Role</span>
                  <span className="w-20 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Grade</span>
                  <span className="w-14 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Teams</span>
                  <span className="w-28 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                </div>

                <motion.div variants={containerVariants} initial="hidden" animate="show">
                  {filteredProfiles.map(p => (
                    <motion.div key={p.id} variants={itemVariants}>
                      {/* Row */}
                      <div
                        className="flex items-stretch border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors cursor-pointer group"
                        onClick={() => setExpandedProfile(expandedProfile === p.id ? null : p.id)}
                      >
                        {/* Role color bar */}
                        <div className={`w-1 flex-shrink-0 ${ROLE_BAR[p.role] || 'bg-[#71717A]'}`} />

                        <div className="flex items-center gap-3 flex-1 px-4 py-3 min-w-0">
                          {/* Avatar */}
                          <div className="flex-shrink-0" onClick={e => editingProfile === p.id ? e.stopPropagation() : undefined}>
                            <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={34} userId={editingProfile !== p.id ? p.id : undefined} />
                          </div>

                          {/* Name / edit form */}
                          <div className="flex-1 min-w-0" onClick={e => editingProfile === p.id ? e.stopPropagation() : undefined}>
                            {editingProfile === p.id ? (
                              <div className="space-y-2" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="text"
                                    value={editForm.full_name}
                                    onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                                    className={`${adminInput} w-40 sm:w-48`}
                                    placeholder="Full name"
                                  />
                                  <select
                                    value={editForm.role}
                                    onChange={e => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                                    className={`${adminSelect} w-32 sm:w-36`}
                                  >
                                    <option value="student">Student</option>
                                    <option value="teacher">Teacher</option>
                                    <option value="coordinator">Coordinator</option>
                                    <option value="principal">Principal</option>
                                    <option value="admin">Admin</option>
                                    <option value="driver">Driver</option>
                                    <option value="smartboard">Smart Board</option>
                                  </select>
                                </div>
                                {(editForm.role === 'student' || editForm.role === 'smartboard') && (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      value={editForm.grade}
                                      onChange={e => setEditForm({ ...editForm, grade: e.target.value })}
                                      className={`${adminSelect} w-20`}
                                      placeholder="Grade"
                                      min="1" max="12"
                                    />
                                    <input
                                      type="text"
                                      value={editForm.section}
                                      onChange={e => setEditForm({ ...editForm, section: e.target.value })}
                                      className={`${adminSelect} w-20`}
                                      placeholder="Section"
                                      maxLength={5}
                                    />
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <button onClick={() => handleSaveEdit(p.id)} disabled={saving} className="flex items-center gap-1 text-xs text-white bg-[#27272A] hover:bg-[#18181B] px-2.5 py-1 rounded-md transition-colors">
                                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                    Save
                                  </button>
                                  <button onClick={() => setEditingProfile(null)} className="flex items-center gap-1 text-xs text-[#71717A] hover:bg-[#F4F4F5] px-2.5 py-1 rounded-md transition-colors">
                                    <X size={12} /> Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className={`text-sm font-semibold truncate ${p.is_banned ? 'text-[#A1A1AA] line-through' : 'text-[#18181B]'}`}>
                                    {p.full_name || 'No Name'}
                                  </p>
                                  {p.is_banned && (
                                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-[#27272A] text-[#A1A1AA] rounded flex-shrink-0 flex items-center gap-1">
                                      <Ban size={8} /> Banned
                                    </span>
                                  )}
                                </div>
                                <p className="hidden sm:block text-xs text-[#71717A] truncate">{p.email}</p>
                              </>
                            )}
                          </div>

                          {/* Role badge — desktop */}
                          <div className="hidden sm:block w-28 flex-shrink-0">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border rounded ${ROLE_BADGE[p.role] || ROLE_BADGE.student}`}>
                              {getRoleDisplayName(p.role)}
                            </span>
                          </div>

                          {/* Grade — desktop */}
                          <span className="hidden sm:block text-xs text-[#71717A] w-20 flex-shrink-0">
                            {p.role === 'student' && p.grade
                              ? `Gr.${p.grade}${p.section ? `-${p.section}` : ''}`
                              : ''}
                          </span>

                          {/* Teams — desktop */}
                          <span className="hidden sm:block text-xs text-[#71717A] w-14 flex-shrink-0">
                            {p.teams.length > 0 ? `${p.teams.length}` : ''}
                          </span>

                          {/* Actions */}
                          <div className="flex items-center gap-0.5 w-28 justify-end flex-shrink-0">
                            <button
                              onClick={e => { e.stopPropagation(); setViewingProfile(p) }}
                              className="p-1.5 text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors"
                              title="View profile card"
                            >
                              <Eye size={14} />
                            </button>
                            {isAdmin && editingProfile !== p.id && (
                              <>
                                <button
                                  onClick={e => { e.stopPropagation(); handleStartEdit(p) }}
                                  className="hidden sm:flex p-1.5 text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors"
                                  title="Edit profile"
                                >
                                  <Edit3 size={14} />
                                </button>
                                {p.id !== user.id && (
                                  <button
                                    onClick={e => { e.stopPropagation(); handleToggleBan(p.id, p.full_name || p.email, !!p.is_banned) }}
                                    className={`hidden sm:flex p-1.5 rounded-lg transition-colors ${p.is_banned ? 'text-[#71717A] hover:text-emerald-600 hover:bg-emerald-50' : 'text-[#71717A] hover:text-amber-600 hover:bg-amber-50'}`}
                                    title={p.is_banned ? 'Restore access' : 'Ban account'}
                                  >
                                    {p.is_banned ? <ShieldCheck size={14} /> : <Ban size={14} />}
                                  </button>
                                )}
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id, p.full_name || p.email) }}
                                  className="hidden sm:flex p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                  title="Delete account"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                            <div className="p-1.5 text-[#71717A]">
                              {expandedProfile === p.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded details */}
                      <AnimatePresence>
                        {expandedProfile === p.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="border-b border-[#F4F4F5] bg-[#FAFAFA] px-5 py-4 pl-8 space-y-3">
                              {/* Mobile: email + actions */}
                              <div className="flex items-center justify-between gap-3 sm:hidden">
                                <p className="text-xs text-[#71717A] truncate flex-1">{p.email}</p>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button
                                    onClick={e => { e.stopPropagation(); setViewingProfile(p) }}
                                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#18181B] bg-white border border-[#D4D4D8] rounded-lg hover:bg-[#F4F4F5] transition-colors"
                                  >
                                    <Eye size={12} /> View
                                  </button>
                                  {isAdmin && editingProfile !== p.id && (
                                    <>
                                      <button
                                        onClick={e => { e.stopPropagation(); handleStartEdit(p) }}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white bg-[#27272A] hover:bg-[#18181B] rounded-lg transition-colors"
                                      >
                                        <Edit3 size={12} /> Edit
                                      </button>
                                      {p.id !== user.id && (
                                        <button
                                          onClick={e => { e.stopPropagation(); handleToggleBan(p.id, p.full_name || p.email, !!p.is_banned) }}
                                          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors ${p.is_banned ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}
                                        >
                                          {p.is_banned ? <><ShieldCheck size={12} /> Unban</> : <><Ban size={12} /> Ban</>}
                                        </button>
                                      )}
                                      <button
                                        onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id, p.full_name || p.email) }}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors"
                                      >
                                        <Trash2 size={12} /> Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Teams */}
                              {p.teams.length > 0 && (
                                <div>
                                  <h5 className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-2 flex items-center gap-1">
                                    <Users size={11} /> Teams ({p.teams.length})
                                  </h5>
                                  <div className="flex flex-wrap gap-1.5">
                                    {p.teams.map(t => (
                                      <span key={t.id} className="text-xs px-2.5 py-1 bg-white border border-[#E4E4E7] text-[#71717A] rounded-lg">
                                        {t.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="text-[11px] text-[#A1A1AA] space-y-0.5">
                                <p>Created: {new Date(p.created_at).toLocaleDateString()}</p>
                                <p className="font-mono text-[10px]">ID: {p.id}</p>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            )}
          </div>

          {/* ── View Profile Modal ── */}
          <AnimatePresence>
            {viewingProfile && (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => setViewingProfile(null)}
                  className="fixed inset-0 bg-black/60 z-40"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 16 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4"
                  onClick={() => setViewingProfile(null)}
                >
                  <div
                    className="w-full max-w-sm bg-white overflow-y-auto shadow-2xl max-h-[85vh] rounded-2xl"
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Banner — uses the live page banner gradient */}
                    <div
                      className="relative h-32 flex-shrink-0 rounded-t-2xl overflow-hidden"
                      style={pageBannerCfg.imageUrl
                        ? { backgroundImage: `url(${pageBannerCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                        : { background: bannerGradient ?? 'linear-gradient(140deg, #3f3f46 0%, #18181b 100%)' }
                      }
                    >
                      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.15),transparent_70%)]" />
                      <button
                        onClick={() => setViewingProfile(null)}
                        className="absolute top-3 right-3 p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    {/* Avatar + info */}
                    <div className="relative flex flex-col items-center -mt-12 pb-6 px-6">
                      <div
                        className="w-24 h-24 rounded-full ring-4 ring-white shadow-xl overflow-hidden flex items-center justify-center flex-shrink-0"
                        style={pageBannerCfg.imageUrl
                          ? { background: '#27272A' }
                          : { background: bannerGradient ?? 'linear-gradient(135deg, #3f3f46, #18181b)' }
                        }
                      >
                        {viewingProfile.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={viewingProfile.avatar_url} alt="Avatar" className="object-cover w-full h-full" />
                        ) : (
                          <span className="text-white text-3xl font-bold select-none">
                            {(viewingProfile.full_name || viewingProfile.email || 'U')
                              .split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                          </span>
                        )}
                      </div>

                      <h2 className="mt-3 text-xl font-bold text-[#18181B] text-center leading-tight">
                        {viewingProfile.full_name || 'No Name'}
                      </h2>
                      <div className="mt-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 border rounded-full ${ROLE_BADGE[viewingProfile.role] || ROLE_BADGE.student}`}>
                          {getRoleDisplayName(viewingProfile.role)}
                        </span>
                      </div>
                      {viewingProfile.role === 'student' && viewingProfile.grade && (
                        <p className="mt-1 text-xs text-[#71717A]">
                          Grade {viewingProfile.grade}{viewingProfile.section ? `-${viewingProfile.section}` : ''}
                        </p>
                      )}

                      <div className="w-full mt-4 space-y-2">
                        <div className="flex items-center gap-3 bg-[#F5F5F5] rounded-xl px-4 py-3">
                          <Mail size={14} className="text-[#71717A] flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Email</p>
                            <p className="font-medium text-[#18181B] text-sm truncate">{viewingProfile.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 bg-[#F5F5F5] rounded-xl px-4 py-3">
                          <Shield size={14} className="text-[#71717A] flex-shrink-0" />
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Role</p>
                            <p className="font-medium text-[#18181B] text-sm">{getRoleDisplayName(viewingProfile.role)}</p>
                          </div>
                        </div>
                        {viewingProfile.created_at && (
                          <div className="flex items-center gap-3 bg-[#F5F5F5] rounded-xl px-4 py-3">
                            <Calendar size={14} className="text-[#71717A] flex-shrink-0" />
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Member since</p>
                              <p className="font-medium text-[#18181B] text-sm">
                                {new Date(viewingProfile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Assessment Marks */}
                      {viewingProfile.role === 'student' && (
                        <div className="w-full mt-5">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-3">Assessment Marks</p>
                          {loadingMarks ? (
                            <div className="flex items-center justify-center py-6 gap-2 text-sm text-[#71717A]">
                              <Loader2 size={14} className="animate-spin" /> Loading marks…
                            </div>
                          ) : profileMarks.length === 0 ? (
                            <p className="text-xs text-[#A1A1AA] text-center py-4">No assessment marks recorded</p>
                          ) : (() => {
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
                                <p className="text-[11px] font-bold text-[#525252] mb-2 flex items-center gap-1">
                                  <span className="inline-block w-2 h-2 bg-[#D4D4D8] rounded-full" />
                                  {year}
                                </p>
                                {(() => {
                                  const byClass: Record<string, StudentMarkWithContext[]> = {}
                                  for (const m of marks) {
                                    if (!byClass[m.classroom_title]) byClass[m.classroom_title] = []
                                    byClass[m.classroom_title].push(m)
                                  }
                                  return Object.entries(byClass).map(([cls, clsMarks]) => (
                                    <div key={cls} className="mb-2 bg-[#F5F5F5] rounded-xl p-3">
                                      <p className="text-xs font-semibold text-[#18181B] mb-2 truncate">{cls}</p>
                                      <div className="space-y-1.5">
                                        {clsMarks.map((m, i) => (
                                          <div key={i} className="flex items-center justify-between gap-2">
                                            <p className="text-xs text-[#71717A] truncate flex-1">{m.assessment_title}</p>
                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                              <span className={`text-xs font-bold ${m.marks === null ? 'text-[#A1A1AA]' : m.marks / m.max_marks >= 0.75 ? 'text-emerald-600' : m.marks / m.max_marks >= 0.5 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                {m.marks ?? '—'}
                                              </span>
                                              <span className="text-[10px] text-[#A1A1AA]">/ {m.max_marks}</span>
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

          {/* ── Create Profile Modal ── */}
          <AnimatePresence>
            {showCreateModal && (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => setShowCreateModal(false)}
                  className="fixed inset-0 bg-black/60 z-40"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 16 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4"
                >
                  <div className="bg-white shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                    {/* Modal header */}
                    <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-lg">
                          <UserPlus size={18} className="text-white" />
                        </div>
                        <h2 className="text-lg font-bold text-white">Create New Profile</h2>
                      </div>
                      <button onClick={() => setShowCreateModal(false)} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
                        <X size={18} className="text-white" />
                      </button>
                    </div>

                    <div className="p-6 overflow-y-auto flex-1" style={{ backgroundColor: '#FDFCF9' }}>
                      {createSuccess ? (
                        <div className="text-center py-8">
                          <div className="w-16 h-16 bg-[#27272A] rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <Check size={32} className="text-white" />
                          </div>
                          <h3 className="font-bold text-lg text-[#18181B] mb-2">Profile Created!</h3>
                          {createdAutoConfirm ? (
                            <div className="space-y-1">
                              <p className="text-sm text-[#71717A]">Account confirmed. The user can sign in immediately.</p>
                              <p className="text-xs text-[#71717A] mt-1">
                                Password: <span className="font-mono font-semibold text-[#18181B]">{createAutoConfirmPassword}</span>
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-[#71717A]">Password reset email sent to {createdEmail}</p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {createError && (
                            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm rounded-lg">
                              {createError}
                            </div>
                          )}

                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Email Address *</label>
                            <input type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} className={adminInputMd} placeholder="user@example.com" disabled={creating} />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Full Name *</label>
                            <input type="text" value={createForm.full_name} onChange={e => setCreateForm({ ...createForm, full_name: e.target.value })} className={adminInputMd} placeholder="John Doe" disabled={creating} />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Role *</label>
                            <select value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value as UserRole })} className={adminInputMd} disabled={creating}>
                              <option value="student">Student</option>
                              <option value="teacher">Teacher</option>
                              <option value="coordinator">Coordinator</option>
                              <option value="principal">Principal</option>
                              <option value="admin">Admin</option>
                              <option value="driver">Driver</option>
                              <option value="smartboard">Smart Board</option>
                            </select>
                            {createForm.role === 'smartboard' && (
                              <p className="text-[11px] text-indigo-600 mt-1.5">
                                Smart boards are kiosk logins — turn on “Set password &amp; activate” below, then link the account to a homeroom in the Homeroom Manager.
                              </p>
                            )}
                          </div>

                          {(createForm.role === 'student' || createForm.role === 'smartboard') && (
                            <>
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Grade</label>
                                <select value={createForm.grade} onChange={e => setCreateForm({ ...createForm, grade: e.target.value })} className={adminInputMd} disabled={creating}>
                                  <option value="">Select grade…</option>
                                  {Array.from({ length: 12 }, (_, i) => i + 1).map(grade => (
                                    <option key={grade} value={grade}>Grade {grade}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Section</label>
                                <select value={createForm.section} onChange={e => setCreateForm({ ...createForm, section: e.target.value })} className={adminInputMd} disabled={creating}>
                                  <option value="">Select section…</option>
                                  {['A', 'B', 'C', 'D', 'E', 'F'].map(s => (
                                    <option key={s} value={s}>Section {s}</option>
                                  ))}
                                </select>
                              </div>
                            </>
                          )}

                          {/* Auto-confirm option */}
                          <div className="border border-[#E4E4E7] bg-white p-3.5 rounded-xl space-y-3">
                            <label className="flex items-start gap-2.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={createAutoConfirm}
                                onChange={e => setCreateAutoConfirm(e.target.checked)}
                                disabled={creating}
                                className="mt-0.5 h-4 w-4 border-[#D4D4D8] accent-[#27272A]"
                              />
                              <span className="text-sm">
                                <span className="font-semibold text-[#18181B]">Auto-confirm account</span>
                                <span className="block text-xs text-[#71717A] mt-0.5">
                                  Skip the invite email — create with a password so the user can sign in immediately.
                                </span>
                              </span>
                            </label>
                            {createAutoConfirm ? (
                              <div className="pl-7">
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Default password</label>
                                <input
                                  type="text"
                                  value={createAutoConfirmPassword}
                                  onChange={e => setCreateAutoConfirmPassword(e.target.value)}
                                  disabled={creating}
                                  placeholder="mps2627"
                                  className="w-full border border-[#D4D4D8] bg-[#F5F5F5] px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-[#27272A] transition-colors rounded-lg"
                                />
                                <p className="text-[11px] text-[#A1A1AA] mt-1">Minimum 6 characters.</p>
                              </div>
                            ) : (
                              <p className="pl-7 text-xs text-[#71717A]">A password setup email will be sent to the user's address.</p>
                            )}
                          </div>

                          <div className="flex gap-3 pt-2">
                            <button
                              onClick={() => setShowCreateModal(false)}
                              className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors"
                              disabled={creating}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleCreateProfile}
                              className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                              disabled={creating}
                            >
                              {creating ? (
                                <><Loader2 size={16} className="animate-spin" /> Creating…</>
                              ) : (
                                <><UserPlus size={16} /> Create Profile</>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {showBulkImport && (
        <BulkImportModal
          existingEmails={new Set(profiles.map(p => p.email.toLowerCase()))}
          onClose={() => setShowBulkImport(false)}
          onDone={() => { loadProfiles(); setShowBulkImport(false) }}
        />
      )}
    </ProtectedLayout>
  )
}
