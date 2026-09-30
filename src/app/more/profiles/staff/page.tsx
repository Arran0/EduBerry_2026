'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import PageBanner from '@/components/PageBanner'
import PageToolbar, { ListSentinel, ToolbarField, toolbarSelect, toolbarSelectWithIcon } from '@/components/PageToolbar'
import { useAuth } from '@/contexts/AuthContext'
import { useProfileCard } from '@/contexts/ProfileCardContext'
import type { AnnouncementBannerConfig } from '@/lib/pageConfig'
import {
  Briefcase,
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
  HardHat,
  Filter,
  ArrowUpDown,
} from 'lucide-react'
import dynamic from 'next/dynamic'
const BulkImportModal = dynamic(() => import('@/components/BulkImportModal'))
const EditStaffDetailsModal = dynamic(() => import('@/components/certificates/EditStaffDetailsModal'))
const EditSupportStaffModal = dynamic(() => import('@/components/staff/EditSupportStaffModal'))
import {
  ProfileWithTeams,
  fetchAllProfiles,
  createNewUser,
  deleteUser,
  toggleBan,
  setUserPassword,
  NewUserInput,
} from '@/lib/admin'
import { UserRole, getDisplayRole } from '@/lib/supabase'
import { upsertStaffDetails, fetchStaffDirectoryMap, StaffDirectoryEntry } from '@/lib/staffDetails'
import {
  SupportStaff,
  fetchSupportStaff,
  createSupportStaff,
  deleteSupportStaff,
  setSupportStaffActive,
} from '@/lib/supportStaff'
import SupportStaffFields, {
  SupportStaffForm,
  SupportFieldKey,
  emptySupportStaffForm,
  formToSupportPatch,
} from '@/components/staff/SupportStaffFields'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'

const STAFF_ROLES: UserRole[] = ['teacher', 'coordinator', 'principal', 'admin', 'driver', 'smartboard']

// Support staff are not profiles and have no login (see src/lib/supportStaff.ts).
// In this manager they are one more option on the role picker, and one more
// kind of row in the list — everywhere else in the app they are invisible.
const SUPPORT_ROLE_VALUE = 'support'

const STAFF_BANNER_DEFAULT = {
  gradFrom: '#92400E',
  gradTo: '#78350F',
  imageUrl: '',
}

const ROLE_BAR: Record<string, string> = {
  admin:         'bg-rose-500',
  principal:     'bg-violet-500',
  coordinator:   'bg-blue-500',
  teacher:       'bg-teal-500',
  'non-teaching': 'bg-cyan-500',
  driver:        'bg-orange-500',
  smartboard:    'bg-indigo-500',
  support:       'bg-lime-600',
}

const ROLE_BADGE: Record<string, string> = {
  admin:         'bg-rose-50 text-rose-700 border-rose-200',
  principal:     'bg-violet-50 text-violet-700 border-violet-200',
  coordinator:   'bg-blue-50 text-blue-700 border-blue-200',
  teacher:       'bg-teal-50 text-teal-700 border-teal-200',
  'non-teaching': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  driver:        'bg-orange-50 text-orange-700 border-orange-200',
  smartboard:    'bg-indigo-50 text-indigo-700 border-indigo-200',
  support:       'bg-lime-50 text-lime-700 border-lime-200',
}

// A "non-teaching" staff member is stored as role='teacher' with is_non_teaching=true
// (same permissions as a teacher, different display label) — see
// supabase-migrations/add_non_teaching_staff_flag.sql for why.
const roleStyleKey = (p: { role: string; is_non_teaching?: boolean }): string =>
  p.role === 'teacher' && p.is_non_teaching ? 'non-teaching' : p.role

// ── Filtering & sorting ──────────────────────────────────────────────────────

const ROLE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All Roles' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'non-teaching', label: 'Non-Teaching' },
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'principal', label: 'Principal' },
  { value: 'admin', label: 'Admin' },
  { value: 'driver', label: 'Driver' },
  { value: 'smartboard', label: 'Smart Board' },
  { value: SUPPORT_ROLE_VALUE, label: 'Support Staff' },
]

// Same order the role band colour and badge maps already use, so "sort by
// role" reads the same top-to-bottom order the rest of the page implies.
const ROLE_SORT_ORDER = ['admin', 'principal', 'coordinator', 'teacher', 'non-teaching', 'driver', 'smartboard', 'support']
const roleRank = (key: string): number => {
  const i = ROLE_SORT_ORDER.indexOf(key)
  return i === -1 ? ROLE_SORT_ORDER.length : i
}

type StatusFilter = 'all' | 'active' | 'inactive'
type SortKey = 'role' | 'name_asc' | 'name_desc' | 'employee_id' | 'designation' | 'recent'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'role', label: 'Role' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'employee_id', label: 'Employee ID' },
  { value: 'designation', label: 'Designation' },
  { value: 'recent', label: 'Recently Added' },
]

/** "12 Jan 2026" for a resignation date, or null if there isn't one on file (resigned before this was tracked). */
function formatResignedDate(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Blank values always sort after real ones, whichever direction is asked for. */
function compareBlanksLast(a: string, b: string, desc = false): number {
  const av = a?.trim() ?? ''
  const bv = b?.trim() ?? ''
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  return desc ? bv.localeCompare(av) : av.localeCompare(bv)
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.025 } },
}
const itemVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
}

export default function StaffProfileManagerPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { openProfileCard } = useProfileCard()

  const [profiles, setProfiles] = useState<ProfileWithTeams[]>([])
  const [supportStaff, setSupportStaff] = useState<SupportStaff[]>([])
  const [details, setDetails] = useState<Record<string, StaffDirectoryEntry>>({})
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortBy, setSortBy] = useState<SortKey>('role')
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [editingDetails, setEditingDetails] = useState<ProfileWithTeams | null>(null)
  const [editingSupport, setEditingSupport] = useState<SupportStaff | null>(null)

  // Set password modal
  const [setPwTarget, setSetPwTarget] = useState<ProfileWithTeams | null>(null)
  const [setPwValue, setSetPwValue] = useState('')
  const [showSetPw, setShowSetPw] = useState(false)
  const [setPwLoading, setSetPwLoading] = useState(false)
  const [setPwMsg, setSetPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [, setPageBannerCfg] = useState<AnnouncementBannerConfig>(STAFF_BANNER_DEFAULT)
  const [bannerEditing, setBannerEditing] = useState(false)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState(false)
  const [createAutoConfirm, setCreateAutoConfirm] = useState(false)
  const [createAutoConfirmPassword, setCreateAutoConfirmPassword] = useState('mps2627')
  const [createdAutoConfirm, setCreatedAutoConfirm] = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')

  const [createForm, setCreateForm] = useState({ email: '', full_name: '', role: 'teacher' as UserRole, is_non_teaching: false })
  // Support Staff is the one option on this picker that is not a UserRole at
  // all — it creates a support_staff row instead of an account, so it is
  // tracked on its own flag rather than squeezed into createForm.role.
  const [createIsSupport, setCreateIsSupport] = useState(false)
  const [createSupportForm, setCreateSupportForm] = useState<SupportStaffForm>(emptySupportStaffForm)
  // The role <select> shows "Non-Teaching" as its own option; it maps to role='teacher' + is_non_teaching=true.
  const createRoleSelection = createIsSupport
    ? SUPPORT_ROLE_VALUE
    : createForm.role === 'teacher' && createForm.is_non_teaching ? 'non-teaching' : createForm.role
  const handleRoleSelect = (value: string) => {
    setCreateIsSupport(value === SUPPORT_ROLE_VALUE)
    if (value === SUPPORT_ROLE_VALUE) return
    if (value === 'non-teaching') setCreateForm(f => ({ ...f, role: 'teacher', is_non_teaching: true }))
    else setCreateForm(f => ({ ...f, role: value as UserRole, is_non_teaching: false }))
  }
  const setSupportField = (key: SupportFieldKey, value: string) =>
    setCreateSupportForm(f => ({ ...f, [key]: value }))
  const [createStaffFields, setCreateStaffFields] = useState({
    employee_id: '', designation: '', department: '', subjects_taught: '',
    employment_type: '', date_of_joining: '', date_of_retirement: '',
    date_of_confirmation: '', cbse_reg_no: '', qualification: '',
    ugc_net_qualified: '', teaching_diploma: '', teaching_experience_years: '',
    date_of_birth: '', gender: '', nationality: '', religion: '', category: '',
    marital_status: '', physically_challenged: '', ex_serviceman: '', blood_group: '',
    phone: '', alternate_phone: '', emergency_contact_name: '', emergency_contact: '',
    emergency_contact_relation: '', address: '', aadhaar_no: '', pan_no: '',
    epf_no: '', nps_no: '', bank_account_no: '', bank_name: '', ifsc_code: '',
  })

  useEffect(() => {
    if (createForm.role === 'smartboard') setCreateAutoConfirm(true)
  }, [createForm.role])

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    const [staffList, support] = await Promise.all([
      fetchAllProfiles({ roles: STAFF_ROLES, withTeams: false }),
      fetchSupportStaff(),
    ])
    setProfiles(staffList)
    setSupportStaff(support)
    // The list only ever shows an employee code, a designation and a
    // department, so it asks for those rather than the whole HR record.
    const map = await fetchStaffDirectoryMap(staffList.map(s => s.id))
    setDetails(map)
    setLoading(false)
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  // Handed to the bulk-import modal; rebuilding the Set on every render made
  // the modal re-check the whole roster for each keystroke behind it.
  const existingEmails = useMemo(
    () => new Set(profiles.map(p => p.email.toLowerCase())),
    [profiles],
  )

  // Both rosters are filtered, counted and sorted below. The Add Staff modal
  // keeps ~35 inputs in this component's state, so without memoisation every
  // keystroke in any of them re-ran all of it over the whole staff list.
  const searchedProfiles = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return profiles.filter(p => {
      const d = details[p.id]
      return (
        p.full_name?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.role?.toLowerCase().includes(q) ||
        getDisplayRole(p).toLowerCase().includes(q) ||
        d?.employee_id?.toLowerCase().includes(q) ||
        d?.designation?.toLowerCase().includes(q) ||
        d?.department?.toLowerCase().includes(q)
      )
    })
  }, [profiles, details, searchQuery])

  const searchedSupport = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return supportStaff.filter(s => (
      s.full_name?.toLowerCase().includes(q) ||
      // Matches the way the staff rows above match on their role name.
      'support'.includes(q) ||
      s.employee_id?.toLowerCase().includes(q) ||
      s.designation?.toLowerCase().includes(q) ||
      s.department?.toLowerCase().includes(q)
    ))
  }, [supportStaff, searchQuery])

  // Counts for the role filter dropdown — computed off the search-filtered
  // set (not role/status-filtered) so switching the role filter never moves
  // the numbers the admin is reading right before they click it.
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of searchedProfiles) {
      const key = roleStyleKey(p)
      counts[key] = (counts[key] ?? 0) + 1
    }
    counts[SUPPORT_ROLE_VALUE] = searchedSupport.length
    return counts
  }, [searchedProfiles, searchedSupport])

  const matchesStatus = (isInactive: boolean) =>
    statusFilter === 'all' || (statusFilter === 'inactive' ? isInactive : !isInactive)

  const filteredProfiles = useMemo(() => searchedProfiles
    .filter(p => (roleFilter === 'all' || roleFilter === roleStyleKey(p)) && matchesStatus(!!p.is_banned))
    .sort((a, b) => {
      if (sortBy === 'role') {
        return roleRank(roleStyleKey(a)) - roleRank(roleStyleKey(b))
          || (a.full_name ?? '').localeCompare(b.full_name ?? '')
      }
      if (sortBy === 'name_desc') return (b.full_name ?? '').localeCompare(a.full_name ?? '')
      if (sortBy === 'employee_id') return compareBlanksLast(details[a.id]?.employee_id ?? '', details[b.id]?.employee_id ?? '')
      if (sortBy === 'designation') return compareBlanksLast(details[a.id]?.designation ?? '', details[b.id]?.designation ?? '')
      if (sortBy === 'recent') return (b.created_at ?? '').localeCompare(a.created_at ?? '')
      return (a.full_name ?? '').localeCompare(b.full_name ?? '') // name_asc
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchedProfiles, details, roleFilter, statusFilter, sortBy])

  const filteredSupport = useMemo(() => searchedSupport
    .filter(s => (roleFilter === 'all' || roleFilter === SUPPORT_ROLE_VALUE) && matchesStatus(!s.is_active))
    .sort((a, b) => {
      if (sortBy === 'name_desc') return b.full_name.localeCompare(a.full_name)
      if (sortBy === 'employee_id') return compareBlanksLast(a.employee_id ?? '', b.employee_id ?? '')
      if (sortBy === 'designation') return compareBlanksLast(a.designation ?? '', b.designation ?? '')
      if (sortBy === 'recent') return (b.created_at ?? '').localeCompare(a.created_at ?? '')
      return a.full_name.localeCompare(b.full_name) // role and name_asc both fall back to name for support staff
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchedSupport, roleFilter, statusFilter, sortBy])

  const totalRows = filteredProfiles.length + filteredSupport.length
  const filtersActive = roleFilter !== 'all' || statusFilter !== 'all'
  const clearFilters = () => { setRoleFilter('all'); setStatusFilter('all') }

  // Staff and support staff are two bands of one list, so they page together:
  // the support band only starts revealing once the staff above it is spent.
  const filterKey = `${searchQuery}|${roleFilter}|${statusFilter}|${sortBy}`
  const staffPaging = useInfiniteScroll(filteredProfiles, { resetKey: filterKey })
  const supportPaging = useInfiniteScroll(filteredSupport, {
    initialCount: Math.max(0, 30 - filteredProfiles.length),
    resetKey: filterKey,
  })
  const shownRows = staffPaging.shown + supportPaging.shown

  const handleDeleteProfile = async (userId: string, name: string) => {
    if (!window.confirm(`Delete account for "${name}"? This cannot be undone.`)) return
    const result = await deleteUser(userId)
    if (result.success) { await loadProfiles() }
    else alert('Failed to delete: ' + result.error)
  }

  const handleToggleBan = async (userId: string, name: string, currentlyBanned: boolean) => {
    const msg = currentlyBanned
      ? `Restore access for "${name}"?`
      : `Resign "${name}"? They will immediately lose the ability to sign in.`
    if (!window.confirm(msg)) return
    const result = await toggleBan(userId, !currentlyBanned)
    if (result.success) { await loadProfiles() }
    else alert('Failed: ' + result.error)
  }

  const handleDeleteSupport = async (person: SupportStaff) => {
    if (!window.confirm(`Delete support staff "${person.full_name}"? Their attendance history goes with them. This cannot be undone.`)) return
    const result = await deleteSupportStaff(person.id)
    if (result.success) await loadProfiles()
    else alert('Failed to delete: ' + result.error)
  }

  const handleToggleSupportActive = async (person: SupportStaff) => {
    const msg = person.is_active
      ? `Resign "${person.full_name}"? They stop appearing in attendance, and their past records are kept.`
      : `Restore "${person.full_name}" to the support staff roster?`
    if (!window.confirm(msg)) return
    const result = await setSupportStaffActive(person.id, !person.is_active)
    if (result.success) await loadProfiles()
    else alert('Failed: ' + result.error)
  }

  const handleCreateSupportStaff = async () => {
    setCreateError(null)
    setCreateSuccess(false)
    if (!createForm.full_name.trim()) { setCreateError('Full name is required'); return }
    setCreating(true)
    const result = await createSupportStaff(
      { ...formToSupportPatch(createSupportForm), full_name: createForm.full_name.trim() },
      user?.id,
    )
    if (result.success) {
      setCreatedAutoConfirm(false)
      setCreatedEmail('')
      setCreateSuccess(true)
      setCreateForm({ email: '', full_name: '', role: 'teacher', is_non_teaching: false })
      setCreateSupportForm(emptySupportStaffForm())
      await loadProfiles()
      setTimeout(() => { setShowCreateModal(false); setCreateSuccess(false) }, 2500)
    } else {
      setCreateError(result.error || 'Failed to add support staff')
    }
    setCreating(false)
  }

  const handleCreateProfile = async () => {
    if (createIsSupport) return handleCreateSupportStaff()
    setCreateError(null)
    setCreateSuccess(false)
    if (!createForm.email || !createForm.full_name) { setCreateError('Email and full name are required'); return }
    if (!createForm.email.includes('@')) { setCreateError('Please enter a valid email address'); return }
    if (createAutoConfirm && createAutoConfirmPassword.length < 6) { setCreateError('Password must be at least 6 characters'); return }
    setCreating(true)
    const input: NewUserInput = {
      email: createForm.email.trim(),
      full_name: createForm.full_name.trim(),
      role: createForm.role,
      is_non_teaching: createForm.is_non_teaching,
      autoConfirm: createAutoConfirm,
      password: createAutoConfirm ? createAutoConfirmPassword : undefined,
    }
    const result = await createNewUser(input)
    if (result.success) {
      if (result.userId) {
        const hasField = Object.values(createStaffFields).some(v => v.trim() !== '')
        if (hasField) {
          const patch: Record<string, string | null> = {}
          for (const [k, v] of Object.entries(createStaffFields)) patch[k] = v.trim() || null
          await upsertStaffDetails(result.userId, patch)
        }
      }
      setCreatedAutoConfirm(!!result.autoConfirm)
      setCreatedEmail(createForm.email.trim())
      setCreateSuccess(true)
      setCreateForm({ email: '', full_name: '', role: 'teacher', is_non_teaching: false })
      const emptyFields: typeof createStaffFields = Object.fromEntries(Object.keys(createStaffFields).map(k => [k, ''])) as typeof createStaffFields
      setCreateStaffFields(emptyFields)
      await loadProfiles()
      setTimeout(() => { setShowCreateModal(false); setCreateSuccess(false); setCreatedAutoConfirm(false); setCreatedEmail('') }, 3000)
    } else {
      setCreateError(result.error || 'Failed to create staff profile')
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
    if (!setPwTarget || setPwValue.length < 6) return
    setSetPwLoading(true)
    setSetPwMsg(null)
    const result = await setUserPassword(setPwTarget.id, setPwValue)
    setSetPwLoading(false)
    if (result.success) {
      setSetPwMsg({ type: 'success', text: 'Password updated successfully' })
      setSetPwValue('')
    } else {
      setSetPwMsg({ type: 'error', text: result.error || 'Failed to update password' })
    }
  }

  if (!user || !profile) return null

  const inp = 'border border-[#D4D4D8] bg-white px-4 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg'
  const lbl = 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5'
  const sHead = 'text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mt-5 mb-3 pb-1 border-b border-[#E4E4E7]'

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ backgroundColor: '#FDFCF9', minHeight: '100vh' }}>
        <PageBanner
          settingKey="staff_profiles_banner"
          defaultBanner={STAFF_BANNER_DEFAULT}
          icon={<Briefcase size={26} className="text-[#B8983C]" />}
          title="Staff Profile Manager"
          subtitle="Manage all non-student staff with full CBSE HR records"
          isAdmin={isAdmin}
          maxWidth="max-w-7xl"
          onBannerChange={setPageBannerCfg}
          onEditingChange={setBannerEditing}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/70 hidden sm:block">
                {profiles.length} staff{supportStaff.length > 0 ? ` · ${supportStaff.length} support` : ''}
              </span>
              <button onClick={() => setShowBulkImport(true)} className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium border border-white/20 rounded-lg transition-colors">
                <FileSpreadsheet size={15} /> Import CSV
              </button>
              <button onClick={() => setShowBulkImport(true)} className="sm:hidden w-10 h-10 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg flex items-center justify-center text-white transition-colors" title="Import CSV">
                <FileSpreadsheet size={18} />
              </button>
              <button onClick={() => setShowCreateModal(true)} className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white text-sm font-medium border border-white/25 rounded-lg backdrop-blur-sm transition-colors">
                <Plus size={15} /> Add Staff
              </button>
              <button onClick={() => setShowCreateModal(true)} className="sm:hidden w-10 h-10 bg-white/15 hover:bg-white/25 border border-white/25 rounded-lg flex items-center justify-center text-white backdrop-blur-sm transition-colors">
                <Plus size={18} />
              </button>
            </div>
          }
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
          <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.3s ease, filter 0.3s ease' }}>

            <PageToolbar
              search={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search staff & support staff by name, email, employee ID, designation…"
              onClearFilters={filtersActive ? clearFilters : undefined}
              summary={!loading ? `${shownRows} of ${totalRows} shown · ${profiles.length} staff${supportStaff.length > 0 ? ` · ${supportStaff.length} support` : ''}` : undefined}
              controls={
                <>
                  <ToolbarField icon={<Filter size={10} />}>
                    <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className={toolbarSelectWithIcon}>
                      {ROLE_FILTER_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>
                          {o.label}{roleCounts[o.value] ? ` (${roleCounts[o.value]})` : o.value === 'all' ? '' : ' (0)'}
                        </option>
                      ))}
                    </select>
                  </ToolbarField>

                  <ToolbarField>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className={toolbarSelect}>
                      <option value="all">All Statuses</option>
                      <option value="active">Active Only</option>
                      <option value="inactive">Resignation Only</option>
                    </select>
                  </ToolbarField>

                  <ToolbarField icon={<ArrowUpDown size={10} />}>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} className={toolbarSelectWithIcon}>
                      {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </ToolbarField>
                </>
              }
            />

            {/* List */}
            {loading ? (
              <div className="border border-[#E4E4E7] bg-white rounded-xl py-16 text-center">
                <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A1A1AA]" />
                <p className="text-sm text-[#71717A]">Loading staff…</p>
              </div>
            ) : totalRows === 0 ? (
              <div className="border border-[#E4E4E7] bg-white rounded-xl p-12 text-center">
                <Briefcase size={36} className="text-[#D4D4D8] mx-auto mb-3" />
                <p className="text-sm font-semibold text-[#18181B] mb-1">No Staff Found</p>
                <p className="text-sm text-[#71717A]">{searchQuery ? 'Try a different search term.' : 'No staff profiles exist yet.'}</p>
              </div>
            ) : (
              <div className="border border-[#E4E4E7] overflow-hidden rounded-xl">
                {/* Column headers */}
                <div className="bg-[#27272A] pl-1 pr-3 py-1.5 hidden sm:flex items-center gap-3">
                  <span className="w-9 flex-shrink-0" />
                  <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Name / Email</span>
                  <span className="w-28 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Role</span>
                  <span className="w-28 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Emp. ID</span>
                  <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Designation</span>
                  <span className="w-44 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                </div>

                <motion.div variants={containerVariants} initial="hidden" animate="show">
                  {staffPaging.visible.map(p => {
                    const d = details[p.id]
                    return (
                      <motion.div key={p.id} variants={itemVariants}>
                        <div className="flex items-stretch border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors cursor-pointer group" onClick={() => openProfileCard(p.id, p)}>
                          <div className={`w-1 flex-shrink-0 ${ROLE_BAR[roleStyleKey(p)] || 'bg-[#71717A]'}`} />
                          <div className="flex items-center gap-3 flex-1 px-3 py-1.5 min-w-0">
                            <div className="flex-shrink-0">
                              <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={26} userId={p.id} profileSeed={p} />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`truncate text-[13px] font-semibold leading-tight ${p.is_banned ? 'text-[#A1A1AA] line-through' : 'text-[#18181B]'}`}>{p.full_name || 'No Name'}</p>
                                {p.is_banned && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-[#27272A] text-[#A1A1AA] rounded flex-shrink-0 flex items-center gap-1">
                                    <Ban size={8} /> Resigned{formatResignedDate(p.banned_at) ? ` · ${formatResignedDate(p.banned_at)}` : ''}
                                  </span>
                                )}
                              </div>
                              <p className="hidden truncate text-[11px] leading-tight text-[#71717A] sm:block">{p.email}</p>
                            </div>

                            {/* Role badge */}
                            <div className="hidden sm:block w-28 flex-shrink-0">
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border rounded ${ROLE_BADGE[roleStyleKey(p)] || ''}`}>{getDisplayRole(p)}</span>
                            </div>

                            {/* Emp ID */}
                            <span className="hidden sm:block text-xs text-[#71717A] w-28 flex-shrink-0 truncate">
                              {d?.employee_id || <span className="text-[#C4C4C8]">—</span>}
                            </span>

                            {/* Designation */}
                            <span className="hidden sm:block text-xs text-[#71717A] w-32 flex-shrink-0 truncate">
                              {d?.designation || <span className="text-[#C4C4C8]">—</span>}
                            </span>

                            {/* Actions */}
                            <div className="flex items-center gap-0.5 w-44 justify-end flex-shrink-0">
                              {isAdmin && (
                                <>
                                  <button onClick={e => { e.stopPropagation(); setEditingDetails(p) }} className="flex p-1.5 text-[#71717A] hover:text-[#B8983C] hover:bg-amber-50 rounded-lg transition-colors" title="Edit HR details"><Pencil size={14} /></button>
                                  <button onClick={e => { e.stopPropagation(); openSetPw(p) }} className="flex p-1.5 text-[#71717A] hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Set password"><KeyRound size={14} /></button>
                                  {p.id !== user.id && (
                                    <button onClick={e => { e.stopPropagation(); handleToggleBan(p.id, p.full_name || p.email, !!p.is_banned) }} className={`flex p-1.5 rounded-lg transition-colors ${p.is_banned ? 'text-[#71717A] hover:text-emerald-600 hover:bg-emerald-50' : 'text-[#71717A] hover:text-amber-600 hover:bg-amber-50'}`} title={p.is_banned ? 'Restore' : 'Resign'}>
                                      {p.is_banned ? <ShieldCheck size={14} /> : <Ban size={14} />}
                                    </button>
                                  )}
                                  <button onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id, p.full_name || p.email) }} className="flex p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Delete"><Trash2 size={14} /></button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}

                  {/* ── Support staff ──────────────────────────────────────
                      Ground-level cleaning / maintenance staff. No account,
                      no login, no email — an admin keeps the names here, and
                      they are used only in attendance and salary. Kept in
                      their own band so they never read as app users. */}
                  {supportPaging.shown > 0 && (
                    <motion.div variants={itemVariants}>
                      <div className="flex items-center gap-2 px-4 py-2 bg-[#F7F7F5] border-y border-[#E4E4E7]">
                        <HardHat size={13} className="text-lime-700 flex-shrink-0" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Support Staff</p>
                        <span className="text-[11px] text-[#A1A1AA]">({filteredSupport.length}) · no login</span>
                      </div>
                    </motion.div>
                  )}

                  {supportPaging.visible.map(s => (
                    <motion.div key={s.id} variants={itemVariants}>
                      <div className="flex items-stretch border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors group">
                        <div className={`w-1 flex-shrink-0 ${ROLE_BAR.support}`} />
                        <div className="flex items-center gap-3 flex-1 px-3 py-1.5 min-w-0">
                          <div className="flex-shrink-0">
                            <Avatar name={s.full_name} size={26} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={`truncate text-[13px] font-semibold leading-tight ${s.is_active ? 'text-[#18181B]' : 'text-[#A1A1AA] line-through'}`}>{s.full_name}</p>
                              {!s.is_active && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-[#27272A] text-[#A1A1AA] rounded flex-shrink-0 flex items-center gap-1">
                                  <Ban size={8} /> Resigned{formatResignedDate(s.resigned_at) ? ` · ${formatResignedDate(s.resigned_at)}` : ''}
                                </span>
                              )}
                            </div>
                            <p className="hidden truncate text-[11px] leading-tight text-[#71717A] sm:block">
                              {s.phone || <span className="text-[#C4C4C8]">No phone</span>}
                            </p>
                          </div>

                          <div className="hidden sm:block w-28 flex-shrink-0">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border rounded ${ROLE_BADGE.support}`}>Support</span>
                          </div>

                          <span className="hidden sm:block text-xs text-[#71717A] w-28 flex-shrink-0 truncate">
                            {s.employee_id || <span className="text-[#C4C4C8]">—</span>}
                          </span>

                          <span className="hidden sm:block text-xs text-[#71717A] w-32 flex-shrink-0 truncate">
                            {s.designation || <span className="text-[#C4C4C8]">—</span>}
                          </span>

                          <div className="flex items-center gap-0.5 w-44 justify-end flex-shrink-0">
                            {isAdmin && (
                              <>
                                <button onClick={() => setEditingSupport(s)} className="flex p-1.5 text-[#71717A] hover:text-[#B8983C] hover:bg-amber-50 rounded-lg transition-colors" title="Edit details"><Pencil size={14} /></button>
                                <button onClick={() => handleToggleSupportActive(s)} className={`flex p-1.5 rounded-lg transition-colors ${s.is_active ? 'text-[#71717A] hover:text-amber-600 hover:bg-amber-50' : 'text-[#71717A] hover:text-emerald-600 hover:bg-emerald-50'}`} title={s.is_active ? 'Resign' : 'Restore'}>
                                  {s.is_active ? <Ban size={14} /> : <ShieldCheck size={14} />}
                                </button>
                                <button onClick={() => handleDeleteSupport(s)} className="flex p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Delete"><Trash2 size={14} /></button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>

                {/* Two sentinels, but only the one with rows left to give is
                    watched — staff first, then support underneath it. */}
                <ListSentinel
                  sentinelRef={staffPaging.hasMore ? staffPaging.sentinelRef : supportPaging.sentinelRef}
                  hasMore={staffPaging.hasMore || supportPaging.hasMore}
                  shown={shownRows} total={totalRows}
                  onLoadMore={staffPaging.hasMore ? staffPaging.loadMore : supportPaging.loadMore}
                  noun="people"
                />
              </div>
            )}
          </div>

          {/* Create Staff Modal */}
          <AnimatePresence>
            {showCreateModal && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCreateModal(false)} className="fixed inset-0 bg-black/60 z-40" />
                <motion.div initial={{ opacity: 0, scale: 0.97, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 16 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-lg">
                          {createIsSupport
                            ? <HardHat size={18} className="text-[#B8983C]" />
                            : <UserPlus size={18} className="text-[#B8983C]" />}
                        </div>
                        <h2 className="text-lg font-bold text-white">{createIsSupport ? 'Add Support Staff' : 'Add Staff Member'}</h2>
                      </div>
                      <button onClick={() => setShowCreateModal(false)} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"><X size={18} className="text-white" /></button>
                    </div>

                    <div className="p-6 overflow-y-auto flex-1" style={{ backgroundColor: '#FDFCF9' }}>
                      {createSuccess ? (
                        <div className="text-center py-8">
                          <div className="w-16 h-16 bg-[#27272A] rounded-2xl flex items-center justify-center mx-auto mb-4"><Check size={32} className="text-white" /></div>
                          <h3 className="font-bold text-lg text-[#18181B] mb-2">{createIsSupport ? 'Support Staff Added!' : 'Staff Profile Created!'}</h3>
                          {createIsSupport
                            ? <p className="text-sm text-[#71717A]">No account was created. Mark their attendance from the Support tab of the staff attendance report.</p>
                            : createdAutoConfirm
                              ? <div className="space-y-1"><p className="text-sm text-[#71717A]">Account confirmed. Staff member can sign in immediately.</p><p className="text-xs text-[#71717A] mt-1">Password: <span className="font-mono font-semibold text-[#18181B]">{createAutoConfirmPassword}</span></p></div>
                              : <p className="text-sm text-[#71717A]">Password setup email sent to {createdEmail}</p>
                          }
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {createError && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm rounded-lg">{createError}</div>}

                          {/* Account info — support staff have no account, so no email */}
                          {!createIsSupport && (
                            <div>
                              <label className={lbl}>Email Address *</label>
                              <input type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} className={inp} placeholder="staff@example.com" disabled={creating} />
                            </div>
                          )}
                          <div>
                            <label className={lbl}>Full Name *</label>
                            <input type="text" value={createForm.full_name} onChange={e => setCreateForm({ ...createForm, full_name: e.target.value })} className={inp} placeholder="John Doe" disabled={creating} />
                          </div>
                          <div>
                            <label className={lbl}>Role *</label>
                            <select value={createRoleSelection} onChange={e => handleRoleSelect(e.target.value)} className={inp} disabled={creating}>
                              <option value="teacher">Teacher</option>
                              <option value="non-teaching">Non-Teaching</option>
                              <option value="coordinator">Coordinator</option>
                              <option value="principal">Principal</option>
                              <option value="admin">Admin</option>
                              <option value="driver">Driver</option>
                              <option value="smartboard">Smart Board</option>
                              <option value={SUPPORT_ROLE_VALUE}>Support Staff</option>
                            </select>
                            {createForm.role === 'smartboard' && !createIsSupport && <p className="text-[11px] text-indigo-600 mt-1.5">Smart boards are kiosk logins — enable auto-confirm below and link to a homeroom in the Homeroom Manager.</p>}
                            {createForm.is_non_teaching && !createIsSupport && <p className="text-[11px] text-cyan-600 mt-1.5">Non-teaching staff get the exact same app access as teachers — only the displayed role label differs.</p>}
                            {createIsSupport && (
                              <p className="text-[11px] text-lime-700 mt-1.5">
                                Support staff (cleaning, maintenance, grounds) get no account and no login — many have no phone.
                                The name is used only for attendance, which an admin marks for them, and for salary.
                              </p>
                            )}
                          </div>

                          {createIsSupport ? (
                            <SupportStaffFields form={createSupportForm} onChange={setSupportField} disabled={creating} />
                          ) : (
                          <>
                          {/* Employment */}
                          <div className="border border-[#E4E4E7] bg-white p-4 rounded-xl space-y-3">
                            <p className={sHead}>Employment</p>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { key: 'employee_id', label: 'Employee ID', placeholder: 'EMP-001' },
                                { key: 'designation', label: 'Designation', placeholder: 'PGT / TGT / PRT…' },
                                { key: 'department', label: 'Department', placeholder: 'Mathematics' },
                                { key: 'subjects_taught', label: 'Subjects Taught', placeholder: 'Mathematics, Science' },
                                { key: 'date_of_joining', label: 'Date of Joining', type: 'date' },
                                { key: 'cbse_reg_no', label: 'CBSE Reg. No.', placeholder: '' },
                              ].map(f => (
                                <div key={f.key}>
                                  <label className={lbl}>{f.label}</label>
                                  <input type={f.type ?? 'text'} value={createStaffFields[f.key as keyof typeof createStaffFields]} onChange={e => setCreateStaffFields(p => ({ ...p, [f.key]: e.target.value }))} className={inp} placeholder={f.placeholder} disabled={creating} />
                                </div>
                              ))}
                              <div>
                                <label className={lbl}>Employment Type</label>
                                <select value={createStaffFields.employment_type} onChange={e => setCreateStaffFields(p => ({ ...p, employment_type: e.target.value }))} className={inp} disabled={creating}>
                                  <option value="">Select…</option>
                                  {['Permanent', 'Contractual', 'Adhoc', 'Deputation', 'Guest'].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* Qualifications */}
                          <div className="border border-[#E4E4E7] bg-white p-4 rounded-xl space-y-3">
                            <p className={sHead}>Qualifications</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className={lbl}>Highest Qualification</label>
                                <input type="text" value={createStaffFields.qualification} onChange={e => setCreateStaffFields(p => ({ ...p, qualification: e.target.value }))} className={inp} placeholder="M.Sc, B.Ed" disabled={creating} />
                              </div>
                              <div>
                                <label className={lbl}>Teaching Diploma</label>
                                <input type="text" value={createStaffFields.teaching_diploma} onChange={e => setCreateStaffFields(p => ({ ...p, teaching_diploma: e.target.value }))} className={inp} placeholder="B.Ed / D.El.Ed…" disabled={creating} />
                              </div>
                              <div>
                                <label className={lbl}>UGC / NET Qualified</label>
                                <select value={createStaffFields.ugc_net_qualified} onChange={e => setCreateStaffFields(p => ({ ...p, ugc_net_qualified: e.target.value }))} className={inp} disabled={creating}>
                                  <option value="">Select…</option>
                                  {['Yes', 'No', 'NA'].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={lbl}>Teaching Experience (Yrs)</label>
                                <input type="text" value={createStaffFields.teaching_experience_years} onChange={e => setCreateStaffFields(p => ({ ...p, teaching_experience_years: e.target.value }))} className={inp} placeholder="5" disabled={creating} />
                              </div>
                            </div>
                          </div>

                          {/* Personal */}
                          <div className="border border-[#E4E4E7] bg-white p-4 rounded-xl space-y-3">
                            <p className={sHead}>Personal</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className={lbl}>Date of Birth</label>
                                <input type="date" value={createStaffFields.date_of_birth} onChange={e => setCreateStaffFields(p => ({ ...p, date_of_birth: e.target.value }))} className={inp} disabled={creating} />
                              </div>
                              <div>
                                <label className={lbl}>Gender</label>
                                <select value={createStaffFields.gender} onChange={e => setCreateStaffFields(p => ({ ...p, gender: e.target.value }))} className={inp} disabled={creating}>
                                  <option value="">Select…</option>
                                  {['Male', 'Female', 'Other', 'Prefer not to say'].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={lbl}>Category</label>
                                <select value={createStaffFields.category} onChange={e => setCreateStaffFields(p => ({ ...p, category: e.target.value }))} className={inp} disabled={creating}>
                                  <option value="">Select…</option>
                                  {['General', 'OBC', 'SC', 'ST', 'EWS'].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={lbl}>Blood Group</label>
                                <select value={createStaffFields.blood_group} onChange={e => setCreateStaffFields(p => ({ ...p, blood_group: e.target.value }))} className={inp} disabled={creating}>
                                  <option value="">Select…</option>
                                  {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={lbl}>Phone</label>
                                <input type="text" value={createStaffFields.phone} onChange={e => setCreateStaffFields(p => ({ ...p, phone: e.target.value }))} className={inp} placeholder="9876543210" disabled={creating} />
                              </div>
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
                              <p className="pl-7 text-xs text-[#71717A]">A password setup email will be sent to the staff member&rsquo;s address.</p>
                            )}
                          </div>
                          </>
                          )}

                          <div className="flex gap-3 pt-2">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors" disabled={creating}>Cancel</button>
                            <button onClick={handleCreateProfile} className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2" disabled={creating}>
                              {creating
                                ? <><Loader2 size={16} className="animate-spin" /> {createIsSupport ? 'Adding…' : 'Creating…'}</>
                                : createIsSupport ? <><HardHat size={16} /> Add Support Staff</> : <><UserPlus size={16} /> Add Staff</>}
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
          mode="staff"
          existingEmails={existingEmails}
          onClose={() => setShowBulkImport(false)}
          onDone={() => { loadProfiles() }}
        />
      )}

      {editingDetails && (
        <EditStaffDetailsModal
          staffId={editingDetails.id}
          staffName={editingDetails.full_name || editingDetails.email}
          staffRole={editingDetails.role}
          staffIsNonTeaching={editingDetails.is_non_teaching}
          staffDisplayRole={editingDetails.display_role}
          onClose={() => setEditingDetails(null)}
          onSaved={loadProfiles}
        />
      )}

      {editingSupport && (
        <EditSupportStaffModal
          person={editingSupport}
          onClose={() => setEditingSupport(null)}
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
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 bg-blue-100 rounded-xl flex-shrink-0">
                  <KeyRound size={18} className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-[#18181B]">Set Password</h2>
                  <p className="text-xs text-[#71717A] truncate">{setPwTarget.full_name || setPwTarget.email}</p>
                </div>
                {!setPwLoading && (
                  <button onClick={() => setSetPwTarget(null)} className="p-1.5 text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg flex-shrink-0">
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <input
                    type={showSetPw ? 'text' : 'password'}
                    value={setPwValue}
                    onChange={e => { setSetPwValue(e.target.value); setSetPwMsg(null) }}
                    placeholder="New password (min 6 chars)"
                    className="w-full pl-4 pr-10 py-3 text-sm border border-[#D4D4D8] rounded-xl focus:outline-none focus:border-[#27272A] transition-colors"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowSetPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A]"
                  >
                    {showSetPw ? <Check size={15} /> : <Check size={15} className="opacity-0" />}
                  </button>
                </div>

                {setPwMsg && (
                  <p className={`text-xs ${setPwMsg.type === 'success' ? 'text-green-600' : 'text-rose-600'}`}>
                    {setPwMsg.text}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setSetPwTarget(null)}
                    disabled={setPwLoading}
                    className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-xl hover:bg-[#F4F4F5] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSetPassword}
                    disabled={setPwLoading || setPwValue.length < 6}
                    className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {setPwLoading ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Set Password'}
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
