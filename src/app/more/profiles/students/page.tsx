'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { useProfileCard } from '@/contexts/ProfileCardContext'
import type { AnnouncementBannerConfig } from '@/lib/pageConfig'
import {
  GraduationCap,
  Search,
  X,
  Loader2,
  Check,
  Trash2,
  Plus,
  FileSpreadsheet,
  Ban,
  ShieldCheck,
  UserPlus,
  Pencil,
  KeyRound,
  Eye,
  EyeOff,
  Filter,
  ArrowUpDown,
} from 'lucide-react'
import dynamic from 'next/dynamic'
const BulkImportModal = dynamic(() => import('@/components/BulkImportModal'))
const EditStudentDetailsModal = dynamic(() => import('@/components/certificates/EditStudentDetailsModal'))
import {
  ProfileWithTeams,
  fetchAllProfiles,
  createNewUser,
  deleteUser,
  toggleBan,
  setUserPassword,
  NewUserInput,
} from '@/lib/admin'
import { UserRole } from '@/lib/supabase'
import { upsertStudentDetails } from '@/lib/studentDetails'
import { GRADE_OPTIONS, gradeLabel } from '@/lib/grades'

const STUDENT_ROLES: UserRole[] = ['student']

const STUDENTS_BANNER_DEFAULT = {
  gradFrom: '#1D4ED8',
  gradTo: '#7C3AED',
  imageUrl: '',
}

// ── Filtering & sorting ──────────────────────────────────────────────────────

const GRADE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All Grades' },
  ...GRADE_OPTIONS.map(g => ({ value: String(g.value), label: g.label })),
]

type StatusFilter = 'all' | 'active' | 'inactive'
type SortKey = 'name_asc' | 'name_desc' | 'grade' | 'recent'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'grade', label: 'Grade' },
  { value: 'recent', label: 'Recently Added' },
]

/** "12 Jan 2026" for a ban date, or null if there isn't one on file (banned before this was tracked). */
function formatBannedDate(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.025 } },
}
const itemVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
}

export default function StudentProfileManagerPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { openProfileCard } = useProfileCard()

  const [profiles, setProfiles] = useState<ProfileWithTeams[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [gradeFilter, setGradeFilter] = useState('all')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortBy, setSortBy] = useState<SortKey>('name_asc')
  const [showBulkImport, setShowBulkImport] = useState(false)

  const [, setPageBannerCfg] = useState<AnnouncementBannerConfig>(STUDENTS_BANNER_DEFAULT)
  const [bannerEditing, setBannerEditing] = useState(false)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState(false)
  const [createAutoConfirm, setCreateAutoConfirm] = useState(false)
  const [createAutoConfirmPassword, setCreateAutoConfirmPassword] = useState('mps2627')
  const [createdAutoConfirm, setCreatedAutoConfirm] = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')

  const [createForm, setCreateForm] = useState({ email: '', full_name: '', grade: '', section: '' })
  const [createStudentFields, setCreateStudentFields] = useState({
    admission_no: '', roll_no: '', date_of_birth: '', father_name: '',
    mother_name: '', guardian_name: '', phone: '', nationality: '',
    mother_tongue: '', religion: '', category: '', caste: '',
    blood_group: '', date_of_admission: '', admission_class: '',
    address: '', aadhaar_no: '',
  })

  const [editingDetails, setEditingDetails] = useState<ProfileWithTeams | null>(null)

  // Set password
  const [setPwTarget, setSetPwTarget] = useState<ProfileWithTeams | null>(null)
  const [setPwValue, setSetPwValue] = useState('')
  const [showSetPw, setShowSetPw] = useState(false)
  const [setPwLoading, setSetPwLoading] = useState(false)
  const [setPwMsg, setSetPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    const data = await fetchAllProfiles()
    setProfiles(data.filter(p => STUDENT_ROLES.includes(p.role)))
    setLoading(false)
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const searchedProfiles = profiles.filter(p => {
    const q = searchQuery.toLowerCase()
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      (p.grade && gradeLabel(p.grade).toLowerCase().includes(q)) ||
      (p.section && p.section.toLowerCase().includes(q))
    )
  })

  // Counts for the grade/section filter dropdowns — computed off the
  // search-filtered set (not grade/section/status-filtered) so switching one
  // filter never moves the numbers the admin is reading right before they
  // click it. Sections aren't a fixed list like grades are, so the dropdown
  // only ever offers the ones actually in use, alphabetically.
  const gradeCounts: Record<string, number> = {}
  const sectionCounts: Record<string, number> = {}
  for (const p of searchedProfiles) {
    const gradeKey = String(p.grade ?? '')
    if (gradeKey) gradeCounts[gradeKey] = (gradeCounts[gradeKey] ?? 0) + 1
    if (p.section) sectionCounts[p.section] = (sectionCounts[p.section] ?? 0) + 1
  }
  const sectionFilterOptions = Object.keys(sectionCounts).sort()

  const matchesStatus = (isBanned: boolean) =>
    statusFilter === 'all' || (statusFilter === 'inactive' ? isBanned : !isBanned)

  const filteredProfiles = searchedProfiles
    .filter(p =>
      (gradeFilter === 'all' || gradeFilter === String(p.grade ?? '')) &&
      (sectionFilter === 'all' || sectionFilter === (p.section ?? '')) &&
      matchesStatus(!!p.is_banned))
    .sort((a, b) => {
      if (sortBy === 'name_desc') return (b.full_name ?? '').localeCompare(a.full_name ?? '')
      if (sortBy === 'grade') return (a.grade ?? 0) - (b.grade ?? 0) || (a.full_name ?? '').localeCompare(b.full_name ?? '')
      if (sortBy === 'recent') return (b.created_at ?? '').localeCompare(a.created_at ?? '')
      return (a.full_name ?? '').localeCompare(b.full_name ?? '') // name_asc
    })

  const filtersActive = gradeFilter !== 'all' || sectionFilter !== 'all' || statusFilter !== 'all'
  const clearFilters = () => { setGradeFilter('all'); setSectionFilter('all'); setStatusFilter('all') }

  const handleDeleteProfile = async (userId: string, name: string) => {
    if (!window.confirm(`Delete account for "${name}"? This cannot be undone.`)) return
    const result = await deleteUser(userId)
    if (result.success) { await loadProfiles() }
    else alert('Failed to delete: ' + result.error)
  }

  const handleToggleBan = async (userId: string, name: string, currentlyBanned: boolean) => {
    const msg = currentlyBanned
      ? `Restore access for "${name}"?`
      : `Ban "${name}"? They will immediately lose the ability to sign in.`
    if (!window.confirm(msg)) return
    const result = await toggleBan(userId, !currentlyBanned)
    if (result.success) { await loadProfiles() }
    else alert(`Failed: ` + result.error)
  }

  const handleCreateProfile = async () => {
    setCreateError(null)
    setCreateSuccess(false)
    if (!createForm.email || !createForm.full_name) { setCreateError('Email and full name are required'); return }
    if (!createForm.email.includes('@')) { setCreateError('Please enter a valid email address'); return }
    if (createAutoConfirm && createAutoConfirmPassword.length < 6) { setCreateError('Password must be at least 6 characters'); return }
    setCreating(true)
    const input: NewUserInput = {
      email: createForm.email.trim(),
      full_name: createForm.full_name.trim(),
      role: 'student',
      grade: createForm.grade ? parseInt(createForm.grade) : undefined,
      section: createForm.section || undefined,
      autoConfirm: createAutoConfirm,
      password: createAutoConfirm ? createAutoConfirmPassword : undefined,
    }
    const result = await createNewUser(input)
    if (result.success) {
      if (result.userId) {
        const hasField = Object.values(createStudentFields).some(v => v.trim() !== '')
        if (hasField) {
          const patch: Record<string, string | null> = {}
          for (const [k, v] of Object.entries(createStudentFields)) patch[k] = v.trim() || null
          await upsertStudentDetails(result.userId, patch)
        }
      }
      setCreatedAutoConfirm(!!result.autoConfirm)
      setCreatedEmail(createForm.email.trim())
      setCreateSuccess(true)
      setCreateForm({ email: '', full_name: '', grade: '', section: '' })
      setCreateStudentFields({
        admission_no: '', roll_no: '', date_of_birth: '', father_name: '',
        mother_name: '', guardian_name: '', phone: '', nationality: '',
        mother_tongue: '', religion: '', category: '', caste: '',
        blood_group: '', date_of_admission: '', admission_class: '',
        address: '', aadhaar_no: '',
      })
      await loadProfiles()
      setTimeout(() => { setShowCreateModal(false); setCreateSuccess(false); setCreatedAutoConfirm(false); setCreatedEmail('') }, 3000)
    } else {
      setCreateError(result.error || 'Failed to create student')
    }
    setCreating(false)
  }

  const openSetPw = (p: ProfileWithTeams) => {
    setSetPwTarget(p)
    setSetPwValue('')
    setShowSetPw(false)
    setSetPwMsg(null)
  }

  const handleSetPassword = async () => {
    if (!setPwTarget || setPwValue.trim().length < 6) return
    setSetPwLoading(true)
    setSetPwMsg(null)
    const result = await setUserPassword(setPwTarget.id, setPwValue.trim())
    setSetPwLoading(false)
    if (result.success) {
      setSetPwMsg({ type: 'success', text: 'Password updated successfully.' })
    } else {
      setSetPwMsg({ type: 'error', text: result.error || 'Failed to set password.' })
    }
  }

  if (!user || !profile) return null

  const inp = 'border border-[#D4D4D8] bg-white px-4 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg'
  const lbl = 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5'

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ backgroundColor: '#FDFCF9', minHeight: '100vh' }}>
        <PageBanner
          settingKey="student_profiles_banner"
          defaultBanner={STUDENTS_BANNER_DEFAULT}
          icon={<GraduationCap size={26} className="text-white" />}
          title="Student Profile Manager"
          subtitle="Create and manage student accounts"
          isAdmin={isAdmin}
          maxWidth="max-w-7xl"
          onBannerChange={setPageBannerCfg}
          onEditingChange={setBannerEditing}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/70 hidden sm:block">{profiles.length} students</span>
              <button
                onClick={() => setShowBulkImport(true)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium border border-white/20 rounded-lg transition-colors"
              >
                <FileSpreadsheet size={15} /> Import CSV
              </button>
              <button onClick={() => setShowBulkImport(true)} className="sm:hidden w-10 h-10 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg flex items-center justify-center text-white transition-colors" title="Import CSV">
                <FileSpreadsheet size={18} />
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white text-sm font-medium border border-white/25 rounded-lg backdrop-blur-sm transition-colors"
              >
                <Plus size={15} /> Add Student
              </button>
              <button onClick={() => setShowCreateModal(true)} className="sm:hidden w-10 h-10 bg-white/15 hover:bg-white/25 border border-white/25 rounded-lg flex items-center justify-center text-white backdrop-blur-sm transition-colors">
                <Plus size={18} />
              </button>
            </div>
          }
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
          <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.3s ease, filter 0.3s ease' }}>

            {/* Search + filter & sort — one row on desktop, search then a
                sleeker filter row underneath on a narrow phone. */}
            <div className="mb-4 relative z-10 flex flex-col sm:flex-row sm:items-center gap-2" style={{ marginTop: '-22px' }}>
              <div className="relative flex-1 min-w-0">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full border border-[#E4E4E7] bg-white pl-10 pr-9 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors placeholder:text-[#A1A1AA] rounded-xl shadow-lg"
                  placeholder="Search by name, email, grade or section…"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A] p-0.5 rounded">
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Every control shrinks to share the row rather than wrapping
                  or scrolling — each is flex-1 with its own text truncated,
                  so all of them stay readable-but-tight on one line even on
                  a narrow phone. */}
              <div className="flex items-center gap-1 flex-nowrap w-full sm:w-auto min-w-0">
                <div className="relative flex-1 min-w-0">
                  <Filter size={9} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
                  <select
                    value={gradeFilter}
                    onChange={e => setGradeFilter(e.target.value)}
                    className="w-full pl-4 pr-1 py-1 text-[9px] sm:text-[11px] font-medium border border-[#E4E4E7] bg-white rounded-md sm:rounded-lg focus:outline-none focus:border-[#27272A] transition-colors appearance-none cursor-pointer truncate"
                  >
                    {GRADE_FILTER_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.label}{gradeCounts[o.value] ? ` (${gradeCounts[o.value]})` : o.value === 'all' ? '' : ' (0)'}
                      </option>
                    ))}
                  </select>
                </div>

                <select
                  value={sectionFilter}
                  onChange={e => setSectionFilter(e.target.value)}
                  className="flex-1 min-w-0 px-1 py-1 text-[9px] sm:text-[11px] font-medium border border-[#E4E4E7] bg-white rounded-md sm:rounded-lg focus:outline-none focus:border-[#27272A] transition-colors appearance-none cursor-pointer truncate"
                >
                  <option value="all">All Sections</option>
                  {sectionFilterOptions.map(s => (
                    <option key={s} value={s}>Section {s} ({sectionCounts[s]})</option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                  className="flex-1 min-w-0 px-1 py-1 text-[9px] sm:text-[11px] font-medium border border-[#E4E4E7] bg-white rounded-md sm:rounded-lg focus:outline-none focus:border-[#27272A] transition-colors appearance-none cursor-pointer truncate"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Banned Only</option>
                </select>

                <div className="relative flex-1 min-w-0">
                  <ArrowUpDown size={9} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortKey)}
                    className="w-full pl-4 pr-1 py-1 text-[9px] sm:text-[11px] font-medium border border-[#E4E4E7] bg-white rounded-md sm:rounded-lg focus:outline-none focus:border-[#27272A] transition-colors appearance-none cursor-pointer truncate"
                  >
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {filtersActive && (
                  <button
                    onClick={clearFilters}
                    aria-label="Clear filters"
                    className="flex-shrink-0 flex items-center gap-1 px-1.5 py-1 text-[9px] sm:text-[11px] font-medium text-[#71717A] hover:text-[#18181B] border border-transparent hover:border-[#E4E4E7] rounded-md sm:rounded-lg transition-colors"
                  >
                    <X size={10} /> <span className="hidden sm:inline">Clear</span>
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            {loading ? (
              <div className="border border-[#E4E4E7] bg-white rounded-xl py-16 text-center">
                <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A1A1AA]" />
                <p className="text-sm text-[#71717A]">Loading students…</p>
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="border border-[#E4E4E7] bg-white rounded-xl p-12 text-center">
                <GraduationCap size={36} className="text-[#D4D4D8] mx-auto mb-3" />
                <p className="text-sm font-semibold text-[#18181B] mb-1">No Students Found</p>
                <p className="text-sm text-[#71717A]">{searchQuery ? 'Try a different search term.' : 'No student profiles exist yet.'}</p>
              </div>
            ) : (
              <div className="border border-[#E4E4E7] overflow-hidden rounded-xl">
                {/* Column headers */}
                <div className="bg-[#27272A] pl-1 pr-4 py-2.5 hidden sm:flex items-center gap-3">
                  <span className="w-9 flex-shrink-0" />
                  <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Name / Email</span>
                  <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Grade</span>
                  <span className="w-36 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                </div>

                <motion.div variants={containerVariants} initial="hidden" animate="show">
                  {filteredProfiles.map(p => (
                    <motion.div key={p.id} variants={itemVariants}>
                      <div
                        className="flex items-stretch border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors cursor-pointer group"
                        onClick={() => openProfileCard(p.id)}
                      >
                        <div className="w-1 flex-shrink-0 bg-blue-500" />
                        <div className="flex items-center gap-3 flex-1 px-4 py-3 min-w-0">
                          <div className="flex-shrink-0">
                            <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={34} userId={p.id} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={`text-sm font-semibold truncate ${p.is_banned ? 'text-[#A1A1AA] line-through' : 'text-[#18181B]'}`}>{p.full_name || 'No Name'}</p>
                              {p.is_banned && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-[#27272A] text-[#A1A1AA] rounded flex-shrink-0 flex items-center gap-1">
                                  <Ban size={8} /> Banned{formatBannedDate(p.banned_at) ? ` · ${formatBannedDate(p.banned_at)}` : ''}
                                </span>
                              )}
                            </div>
                            <p className="hidden sm:block text-xs text-[#71717A] truncate">{p.email}</p>
                          </div>

                          {/* Grade */}
                          <span className="hidden sm:block text-xs text-[#71717A] w-24 flex-shrink-0">
                            {p.grade ? `${gradeLabel(p.grade)}${p.section ? `-${p.section}` : ''}` : '—'}
                          </span>

                          {/* Actions */}
                          <div className="flex items-center gap-0.5 w-36 justify-end flex-shrink-0">
                            {isAdmin && (
                              <>
                                <button onClick={e => { e.stopPropagation(); setEditingDetails(p) }} className="flex p-1.5 text-[#71717A] hover:text-[#B8983C] hover:bg-amber-50 rounded-lg transition-colors" title="Edit student details"><Pencil size={14} /></button>
                                <button onClick={e => { e.stopPropagation(); openSetPw(p) }} className="flex p-1.5 text-[#71717A] hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Set password"><KeyRound size={14} /></button>
                                {p.id !== user.id && (
                                  <button onClick={e => { e.stopPropagation(); handleToggleBan(p.id, p.full_name || p.email, !!p.is_banned) }} className={`flex p-1.5 rounded-lg transition-colors ${p.is_banned ? 'text-[#71717A] hover:text-emerald-600 hover:bg-emerald-50' : 'text-[#71717A] hover:text-amber-600 hover:bg-amber-50'}`} title={p.is_banned ? 'Restore' : 'Ban'}>
                                    {p.is_banned ? <ShieldCheck size={14} /> : <Ban size={14} />}
                                  </button>
                                )}
                                <button onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id, p.full_name || p.email) }} className="flex p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Delete">
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            )}
          </div>

          {/* Create Student Modal */}
          <AnimatePresence>
            {showCreateModal && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCreateModal(false)} className="fixed inset-0 bg-black/60 z-40" />
                <motion.div initial={{ opacity: 0, scale: 0.97, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 16 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-lg"><UserPlus size={18} className="text-white" /></div>
                        <h2 className="text-lg font-bold text-white">Add Student</h2>
                      </div>
                      <button onClick={() => setShowCreateModal(false)} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"><X size={18} className="text-white" /></button>
                    </div>

                    <div className="p-6 overflow-y-auto flex-1" style={{ backgroundColor: '#FDFCF9' }}>
                      {createSuccess ? (
                        <div className="text-center py-8">
                          <div className="w-16 h-16 bg-[#27272A] rounded-2xl flex items-center justify-center mx-auto mb-4"><Check size={32} className="text-white" /></div>
                          <h3 className="font-bold text-lg text-[#18181B] mb-2">Student Created!</h3>
                          {createdAutoConfirm
                            ? <div className="space-y-1"><p className="text-sm text-[#71717A]">Account confirmed. Student can sign in immediately.</p><p className="text-xs text-[#71717A] mt-1">Password: <span className="font-mono font-semibold text-[#18181B]">{createAutoConfirmPassword}</span></p></div>
                            : <p className="text-sm text-[#71717A]">Password setup email sent to {createdEmail}</p>
                          }
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {createError && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm rounded-lg">{createError}</div>}

                          <div>
                            <label className={lbl}>Email Address *</label>
                            <input type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} className={inp} placeholder="student@example.com" disabled={creating} />
                          </div>
                          <div>
                            <label className={lbl}>Full Name *</label>
                            <input type="text" value={createForm.full_name} onChange={e => setCreateForm({ ...createForm, full_name: e.target.value })} className={inp} placeholder="Jane Doe" disabled={creating} />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className={lbl}>Grade</label>
                              <select value={createForm.grade} onChange={e => setCreateForm({ ...createForm, grade: e.target.value })} className={inp} disabled={creating}>
                                <option value="">Select…</option>
                                {GRADE_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className={lbl}>Section</label>
                              <select value={createForm.section} onChange={e => setCreateForm({ ...createForm, section: e.target.value })} className={inp} disabled={creating}>
                                <option value="">Select…</option>
                                {Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).map(s => <option key={s} value={s}>Section {s}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* Student Details */}
                          <div className="border border-[#E4E4E7] bg-white p-4 rounded-xl space-y-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Student Details <span className="font-normal normal-case text-[#A1A1AA]">(optional)</span></p>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { key: 'admission_no', label: 'Admission No.', placeholder: 'ADM-2024-001' },
                                { key: 'roll_no', label: 'Roll No.', placeholder: '21' },
                                { key: 'date_of_birth', label: 'Date of Birth', type: 'date' },
                                { key: 'date_of_admission', label: 'Date of Admission', type: 'date' },
                                { key: 'admission_class', label: 'Admission Class', placeholder: 'Nursery / Grade 1…' },
                                { key: 'phone', label: 'Parent Phone', placeholder: '9876543210' },
                                { key: 'father_name', label: "Father's Name", placeholder: 'Full name' },
                                { key: 'mother_name', label: "Mother's Name", placeholder: 'Full name' },
                                { key: 'guardian_name', label: "Guardian's Name", placeholder: 'Full name (if applicable)' },
                                { key: 'mother_tongue', label: 'Mother Tongue', placeholder: 'Tamil / Hindi…' },
                                { key: 'nationality', label: 'Nationality', placeholder: 'Indian' },
                                { key: 'religion', label: 'Religion', placeholder: 'Hindu / Christian…' },
                              ].map(f => (
                                <div key={f.key}>
                                  <label className={lbl}>{f.label}</label>
                                  <input type={f.type ?? 'text'} value={createStudentFields[f.key as keyof typeof createStudentFields]} onChange={e => setCreateStudentFields(p => ({ ...p, [f.key]: e.target.value }))} className={inp} placeholder={f.placeholder} disabled={creating} />
                                </div>
                              ))}
                              <div>
                                <label className={lbl}>Category</label>
                                <select value={createStudentFields.category} onChange={e => setCreateStudentFields(p => ({ ...p, category: e.target.value }))} className={inp} disabled={creating}>
                                  <option value="">Select…</option>
                                  {['General', 'OBC', 'SC', 'ST', 'EWS'].map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={lbl}>Caste</label>
                                <input type="text" value={createStudentFields.caste} onChange={e => setCreateStudentFields(p => ({ ...p, caste: e.target.value }))} className={inp} placeholder="Caste (if applicable)" disabled={creating} />
                              </div>
                              <div>
                                <label className={lbl}>Blood Group</label>
                                <select value={createStudentFields.blood_group} onChange={e => setCreateStudentFields(p => ({ ...p, blood_group: e.target.value }))} className={inp} disabled={creating}>
                                  <option value="">Select…</option>
                                  {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={lbl}>Aadhaar No.</label>
                                <input type="text" value={createStudentFields.aadhaar_no} onChange={e => setCreateStudentFields(p => ({ ...p, aadhaar_no: e.target.value }))} className={inp} placeholder="XXXX XXXX XXXX" disabled={creating} />
                              </div>
                            </div>
                            <div>
                              <label className={lbl}>Address</label>
                              <textarea value={createStudentFields.address} onChange={e => setCreateStudentFields(p => ({ ...p, address: e.target.value }))} className="border border-[#D4D4D8] bg-white px-4 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg" rows={2} placeholder="Full residential address" disabled={creating} />
                            </div>
                          </div>

                          {/* Auto-confirm */}
                          <div className="border border-[#E4E4E7] bg-white p-3.5 rounded-xl space-y-3">
                            <label className="flex items-start gap-2.5 cursor-pointer">
                              <input type="checkbox" checked={createAutoConfirm} onChange={e => setCreateAutoConfirm(e.target.checked)} disabled={creating} className="mt-0.5 h-4 w-4 border-[#D4D4D8] accent-[#27272A]" />
                              <span className="text-sm">
                                <span className="font-semibold text-[#18181B]">Auto-confirm account</span>
                                <span className="block text-xs text-[#71717A] mt-0.5">Skip the invite email and set a password immediately.</span>
                              </span>
                            </label>
                            {createAutoConfirm ? (
                              <div className="pl-7">
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Default password</label>
                                <input type="text" value={createAutoConfirmPassword} onChange={e => setCreateAutoConfirmPassword(e.target.value)} disabled={creating} placeholder="mps2627" className="w-full border border-[#D4D4D8] bg-[#F5F5F5] px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-[#27272A] transition-colors rounded-lg" />
                                <p className="text-[11px] text-[#A1A1AA] mt-1">Minimum 6 characters.</p>
                              </div>
                            ) : (
                              <p className="pl-7 text-xs text-[#71717A]">A password setup email will be sent to the student&rsquo;s email address.</p>
                            )}
                          </div>

                          <div className="flex gap-3 pt-2">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors" disabled={creating}>Cancel</button>
                            <button onClick={handleCreateProfile} className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2" disabled={creating}>
                              {creating ? <><Loader2 size={16} className="animate-spin" /> Creating…</> : <><UserPlus size={16} /> Add Student</>}
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
          mode="student"
          existingEmails={new Set(profiles.map(p => p.email.toLowerCase()))}
          onClose={() => setShowBulkImport(false)}
          onDone={() => { loadProfiles() }}
        />
      )}

      {editingDetails && (
        <EditStudentDetailsModal
          studentId={editingDetails.id}
          studentName={editingDetails.full_name || editingDetails.email}
          studentGrade={editingDetails.grade}
          studentSection={editingDetails.section}
          studentDisplayRole={editingDetails.display_role}
          onClose={() => setEditingDetails(null)}
          onSaved={loadProfiles}
        />
      )}

      {/* Set Password Modal */}
      <AnimatePresence>
        {setPwTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => { if (!setPwLoading) setSetPwTarget(null) }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-blue-100 rounded-xl flex-shrink-0">
                  <KeyRound size={18} className="text-blue-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-[#18181B]">Set Password</h2>
                  <p className="text-xs text-[#71717A] truncate">{setPwTarget.full_name || setPwTarget.email}</p>
                </div>
                {!setPwLoading && (
                  <button onClick={() => setSetPwTarget(null)} className="ml-auto p-1.5 text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg flex-shrink-0">
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <input
                    type={showSetPw ? 'text' : 'password'}
                    value={setPwValue}
                    onChange={e => setSetPwValue(e.target.value)}
                    placeholder="New password (min 6 chars)"
                    autoFocus
                    disabled={setPwLoading}
                    className="w-full border border-[#D4D4D8] bg-white pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSetPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A]"
                  >
                    {showSetPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                {setPwMsg && (
                  <p className={`text-xs px-3 py-2 rounded-lg ${setPwMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                    {setPwMsg.text}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setSetPwTarget(null)}
                    disabled={setPwLoading}
                    className="flex-1 px-4 py-2 text-sm font-medium text-[#18181B] border border-[#D4D4D8] rounded-xl hover:bg-[#F4F4F5] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSetPassword}
                    disabled={setPwLoading || setPwValue.trim().length < 6}
                    className="flex-1 px-4 py-2 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] disabled:opacity-50 text-white rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {setPwLoading ? <><Loader2 size={14} className="animate-spin" /> Setting…</> : 'Set Password'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ProtectedLayout>
  )
}
