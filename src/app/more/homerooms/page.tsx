'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  Home, Plus, X, UserMinus, ChevronDown, ChevronUp,
  Edit3, Save, Loader2, Search, Trash2, Users, RefreshCw, CheckCircle2, Calendar,
  MonitorPlay, KeyRound, Mail,
} from 'lucide-react'
import { HOMEROOMS_BANNER_DEFAULT } from '@/lib/pageConfig'
import { UserProfile } from '@/lib/supabase'
import {
  Homeroom, HomeroomWithMembers,
  fetchAllHomerooms, createHomeroom, updateHomeroom, deleteHomeroom,
  fetchHomeroomWithMembers, addHomeroomMemberByEmail, removeHomeroomMember,
  homeroomGradeSectionBadge, fetchHomeroomSmartboard,
  linkSmartboardToHomeroom, unlinkSmartboardFromHomeroom,
} from '@/lib/homerooms'

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1)
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F']

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.025 } },
}

const itemVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
}

const ai = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'
const aiSm = 'border border-[#D4D4D8] bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors'

function autoName(grade: number | '', section: string): string {
  if (grade && section) return `Grade ${grade} Section ${section}`
  if (grade) return `Grade ${grade}`
  return ''
}

export default function HomeroomsPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile?.role === 'admin'

  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<HomeroomWithMembers | null>(null)
  const [loadingExpanded, setLoadingExpanded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [bannerEditing, setBannerEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', grade: '' as number | '', section: '' })
  const [editNameManual, setEditNameManual] = useState(false)
  const [saving, setSaving] = useState(false)

  const [newGrade, setNewGrade] = useState<number | ''>('')
  const [newSection, setNewSection] = useState('')
  const [newName, setNewName] = useState('')
  const [newExpiryDate, setNewExpiryDate] = useState('')
  const [nameManual, setNameManual] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{
    synced: number; total: number; errors: number
    diagnostic?: { totalProfiles: number; studentProfiles: number; studentsWithGradeAndSection: number; studentsWithoutGradeOrSection: number }
    apiError?: string
  } | null>(null)

  const [addEmail, setAddEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState('')

  // Smart board account (per expanded homeroom)
  const [smartboard, setSmartboard] = useState<UserProfile | null>(null)
  const [loadingSmartboard, setLoadingSmartboard] = useState(false)
  const [showSbForm, setShowSbForm] = useState(false)
  const [sbEmail, setSbEmail] = useState('')
  const [sbName, setSbName] = useState('')
  const [sbPassword, setSbPassword] = useState('')
  const [sbCreating, setSbCreating] = useState(false)
  const [sbError, setSbError] = useState('')
  const [showSbLink, setShowSbLink] = useState(false)
  const [sbLinkEmail, setSbLinkEmail] = useState('')
  const [sbLinking, setSbLinking] = useState(false)

  const loadHomerooms = useCallback(async () => {
    setLoading(true)
    const data = await fetchAllHomerooms()
    setHomerooms(data)
    setLoading(false)
  }, [])

  useEffect(() => { loadHomerooms() }, [loadHomerooms])

  const handleSync = async () => {
    if (!user) return
    setSyncing(true); setSyncResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/admin/sync-homerooms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      if (json.success) {
        setSyncResult({ synced: json.synced, total: json.total, errors: json.errors?.length ?? 0, diagnostic: json.diagnostic })
        if (json.synced > 0) await loadHomerooms()
      } else {
        setSyncResult({ synced: 0, total: 0, errors: 1, apiError: json.error })
      }
    } catch (err) {
      setSyncResult({ synced: 0, total: 0, errors: 1, apiError: String(err) })
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!nameManual) setNewName(autoName(newGrade, newSection))
  }, [newGrade, newSection, nameManual])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) { setCreateError('Name is required'); return }
    setCreating(true); setCreateError('')
    const result = await createHomeroom(name, newGrade || null, newSection || null, user?.id, null, newExpiryDate || null)
    if (result) {
      setNewGrade(''); setNewSection(''); setNewName(''); setNewExpiryDate(''); setNameManual(false)
      setShowCreateForm(false); await loadHomerooms()
    } else {
      setCreateError('Failed to create homeroom')
    }
    setCreating(false)
  }

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); setExpandedData(null); setEditingId(null); return }
    setExpandedId(id); setExpandedData(null); setLoadingExpanded(true); setMemberError(''); setAddEmail('')
    // Reset smart board section for the newly expanded homeroom.
    setSmartboard(null); setShowSbForm(false); setSbEmail(''); setSbName(''); setSbPassword(''); setSbError('')
    setShowSbLink(false); setSbLinkEmail('')
    setLoadingSmartboard(true)
    const [data, sb] = await Promise.all([
      fetchHomeroomWithMembers(id),
      fetchHomeroomSmartboard(id),
    ])
    setExpandedData(data); setLoadingExpanded(false)
    setSmartboard(sb); setLoadingSmartboard(false)
  }

  const handleCreateSmartboard = async () => {
    if (!expandedId || !user) return
    if (!sbEmail.trim() || !sbName.trim() || sbPassword.length < 6) {
      setSbError('Email, name, and a password of at least 6 characters are required')
      return
    }
    setSbCreating(true); setSbError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setSbError('Session expired'); setSbCreating(false); return }
      const res = await fetch('/api/admin/create-smartboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ homeroomId: expandedId, email: sbEmail.trim(), full_name: sbName.trim(), password: sbPassword }),
      })
      const json = await res.json()
      if (json.success) {
        setShowSbForm(false); setSbEmail(''); setSbName(''); setSbPassword('')
        const sb = await fetchHomeroomSmartboard(expandedId)
        setSmartboard(sb)
      } else {
        setSbError(json.error ?? 'Failed to create smart board account')
      }
    } catch (err) {
      setSbError(String(err))
    } finally {
      setSbCreating(false)
    }
  }

  const handleLinkSmartboard = async () => {
    if (!expandedId || !sbLinkEmail.trim()) return
    setSbLinking(true); setSbError('')
    const result = await linkSmartboardToHomeroom(expandedId, sbLinkEmail.trim())
    setSbLinking(false)
    if (result.success) {
      setShowSbLink(false); setSbLinkEmail('')
      const sb = await fetchHomeroomSmartboard(expandedId)
      setSmartboard(sb)
    } else {
      setSbError(result.error ?? 'Failed to link smart board')
    }
  }

  const handleUnlinkSmartboard = async () => {
    if (!expandedId) return
    if (!confirm('Unlink this smart board from the homeroom? The account is kept and can be linked elsewhere.')) return
    const ok = await unlinkSmartboardFromHomeroom(expandedId)
    if (ok) setSmartboard(null)
  }

  const handleRemoveSmartboard = async () => {
    if (!expandedId || !user) return
    if (!confirm('Remove this smart board account? The login will be deleted and unlinked from its classrooms.')) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/admin/create-smartboard', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ homeroomId: expandedId }),
    })
    const json = await res.json()
    if (json.success) setSmartboard(null)
  }

  const handleStartEdit = (hr: Homeroom) => {
    setEditingId(hr.id)
    setEditForm({ name: hr.name, grade: hr.grade ?? '', section: hr.section ?? '' })
    setEditNameManual(true)
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    await updateHomeroom(editingId, editForm.name.trim() || autoName(editForm.grade, editForm.section), editForm.grade || null, editForm.section || null)
    setEditingId(null)
    await loadHomerooms()
    if (expandedId === editingId) {
      const updated = await fetchHomeroomWithMembers(editingId)
      setExpandedData(updated)
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this homeroom? All attendance records linked to it will also be deleted.')) return
    await deleteHomeroom(id)
    if (expandedId === id) { setExpandedId(null); setExpandedData(null) }
    await loadHomerooms()
  }

  const handleAddMember = async () => {
    if (!expandedId || !addEmail.trim()) return
    setAddingMember(true); setMemberError('')
    const result = await addHomeroomMemberByEmail(expandedId, addEmail.trim())
    if (result.success) {
      setAddEmail('')
      if (result.linkedSmartboard) {
        // The email belonged to a smart board → it was linked, not added as a member.
        const sb = await fetchHomeroomSmartboard(expandedId)
        setSmartboard(sb)
      } else {
        const updated = await fetchHomeroomWithMembers(expandedId)
        setExpandedData(updated)
      }
    } else {
      setMemberError(result.error ?? 'Failed to add student')
    }
    setAddingMember(false)
  }

  const handleRemoveMember = async (studentId: string) => {
    if (!expandedId) return
    await removeHomeroomMember(expandedId, studentId)
    const updated = await fetchHomeroomWithMembers(expandedId)
    setExpandedData(updated)
  }

  if (!user || !profile) return null

  const searchLower = search.toLowerCase()
  const filtered = searchLower
    ? homerooms.filter((h: Homeroom) =>
        h.name.toLowerCase().includes(searchLower) ||
        (h.grade && String(h.grade).includes(searchLower)) ||
        (h.section && h.section.toLowerCase().includes(searchLower))
      )
    : homerooms

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ backgroundColor: '#FDFCF9', minHeight: '100vh' }}>
        <PageBanner
          settingKey="homerooms_banner"
          defaultBanner={HOMEROOMS_BANNER_DEFAULT}
          icon={<Home size={26} className="text-white" />}
          title="Homeroom Manager"
          subtitle="Create and manage homerooms for attendance"
          isAdmin={isAdmin}
          onEditingChange={setBannerEditing}
          onBack={() => router.back()}
          maxWidth="max-w-7xl"
          actions={isAdmin ? (
            <>
              <button
                onClick={() => setShowCreateForm(p => !p)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg border border-[#27272A] transition-colors"
              >
                {showCreateForm ? <X size={15} /> : <Plus size={15} />}
                {showCreateForm ? 'Cancel' : 'New Homeroom'}
              </button>
              <button
                onClick={() => setShowCreateForm(p => !p)}
                className="sm:hidden w-10 h-10 bg-[#27272A] hover:bg-[#18181B] border border-[#27272A] rounded-lg flex items-center justify-center text-white transition-colors"
              >
                {showCreateForm ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          ) : undefined}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10" style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Sync result banner */}
          <AnimatePresence>
            {syncResult && (
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className={`mb-3 px-4 py-3 text-sm border flex items-start gap-3 ${
                  syncResult.apiError
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : syncResult.total === 0
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-[#F5F5F5] border-[#D4D4D8] text-[#18181B]'
                }`}
              >
                <CheckCircle2 size={15} className={`flex-shrink-0 mt-0.5 ${syncResult.apiError ? 'text-rose-400' : syncResult.total === 0 ? 'text-amber-400' : 'text-[#71717A]'}`} />
                <div className="flex-1 space-y-0.5">
                  {syncResult.apiError ? (
                    <p>Sync failed: {syncResult.apiError}</p>
                  ) : syncResult.total === 0 ? (
                    <>
                      <p className="font-medium">No students with grade &amp; section found.</p>
                      {syncResult.diagnostic && (
                        <p className="text-xs opacity-80">
                          {syncResult.diagnostic.totalProfiles} total · {syncResult.diagnostic.studentProfiles} students · {syncResult.diagnostic.studentsWithGradeAndSection} have grade+section, {syncResult.diagnostic.studentsWithoutGradeOrSection} do not.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>Synced <strong>{syncResult.synced}</strong> of <strong>{syncResult.total}</strong> students into their homerooms.</p>
                  )}
                </div>
                <button onClick={() => setSyncResult(null)} className="text-current opacity-40 hover:opacity-70 flex-shrink-0"><X size={13} /></button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Create form */}
          <AnimatePresence>
            {showCreateForm && (
              <motion.div
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="mb-3 border border-[#D4D4D8] border-l-4 border-l-[#525252] bg-[#F5F5F5] rounded-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#D4D4D8] bg-[#27272A]">
                  <span className="text-sm font-bold text-[#F5F5F5]">New Homeroom</span>
                  <button type="button" onClick={() => setShowCreateForm(false)} className="text-[#F5F5F5]/60 hover:text-[#F5F5F5] transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleCreate} className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Grade</label>
                      <select value={newGrade} onChange={e => { setNewGrade(e.target.value ? Number(e.target.value) : ''); setNameManual(false) }} className={ai}>
                        <option value="">— optional —</option>
                        {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Section</label>
                      <select value={newSection} onChange={e => { setNewSection(e.target.value); setNameManual(false) }} className={ai}>
                        <option value="">— optional —</option>
                        {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">
                      Homeroom Name *
                      {!nameManual && newName && <span className="ml-2 text-[#71717A] font-normal normal-case">auto-filled</span>}
                    </label>
                    <input
                      type="text" value={newName}
                      onChange={e => { setNewName(e.target.value); setNameManual(true) }}
                      placeholder="e.g. Grade 7 Section A"
                      className={ai} required
                    />
                    {createError && <p className="text-xs text-rose-600 mt-1">{createError}</p>}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">
                      Expiry Date <span className="text-[#A1A1AA] font-normal normal-case">(optional)</span>
                    </label>
                    <input type="date" value={newExpiryDate} onChange={e => setNewExpiryDate(e.target.value)} className={ai} />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="submit" disabled={creating} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50">
                      {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                      Create Homeroom
                    </button>
                    <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm hover:bg-[#EBEBEB] transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search + Sync toolbar */}
          {!loading && (
            <div className="mb-3 flex items-center gap-2">
              {homerooms.length > 0 && (
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
                  <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    className="w-full border border-[#D4D4D8] bg-white pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors placeholder:text-[#A1A1AA] rounded-xl shadow-lg"
                    placeholder="Search by name, grade, or section…"
                  />
                  {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A]"><X size={13} /></button>}
                </div>
              )}
              {isAdmin && (
                <button
                  onClick={handleSync} disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#D4D4D8] text-sm font-medium text-[#18181B] hover:bg-[#EBEBEB] hover:border-[#71717A] transition-colors disabled:opacity-50 whitespace-nowrap rounded-lg"
                  title="Auto-enroll students into homerooms"
                >
                  {syncing ? <Loader2 size={13} className="animate-spin text-[#A1A1AA]" /> : <RefreshCw size={13} className="text-[#71717A]" />}
                  {syncing ? 'Syncing…' : 'Sync Students'}
                </button>
              )}
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] py-16 text-center">
              <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A1A1AA]" />
              <p className="text-sm text-[#71717A]">Loading homerooms…</p>
            </div>
          ) : homerooms.length === 0 ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] p-12 text-center">
              <Home size={36} className="text-[#D4D4D8] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#18181B] mb-1">No homerooms yet</p>
              <p className="text-sm text-[#71717A] mb-5">Create your first homeroom to start tracking attendance.</p>
              <button onClick={() => setShowCreateForm(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors mx-auto">
                <Plus size={14} /> Create Homeroom
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] p-10 text-center">
              <p className="text-sm text-[#71717A]">No homerooms match &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
            <div className="border border-[#D4D4D8] rounded-xl overflow-hidden">
              {/* Column headers */}
              <div className="bg-[#27272A] px-4 py-2.5 hidden sm:flex items-center gap-3">
                <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Name</span>
                <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Grade/Section</span>
                <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Expiry</span>
                <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
              </div>

              <motion.div variants={containerVariants} initial="hidden" animate="show">
                {filtered.map(hr => (
                  <motion.div key={hr.id} variants={itemVariants}>
                    {/* Row */}
                    <div className="flex items-stretch border-b border-[#E4E4E7] last:border-b-0 hover:bg-[#EBEBEB] transition-colors">
                      <div className="w-1 flex-shrink-0 bg-[#D4D4D8]" />
                      <div className="flex items-center gap-3 flex-1 px-4 py-3 min-w-0">

                        {editingId === hr.id ? (
                          /* Inline edit */
                          <div className="flex-1 space-y-2">
                            <input
                              type="text" value={editForm.name}
                              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                              className={`${aiSm} w-full`} placeholder="Homeroom name"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <select value={editForm.grade} onChange={e => setEditForm(f => ({ ...f, grade: e.target.value ? Number(e.target.value) : '' }))} className={`${aiSm} text-xs`}>
                                <option value="">No grade</option>
                                {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                              </select>
                              <select value={editForm.section} onChange={e => setEditForm(f => ({ ...f, section: e.target.value }))} className={`${aiSm} text-xs`}>
                                <option value="">No section</option>
                                {SECTIONS.map(s => <option key={s} value={s}>Section {s}</option>)}
                              </select>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Name */}
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleExpand(hr.id)}>
                              <p className="text-sm font-semibold text-[#18181B] truncate">{hr.name}</p>
                              {hr.academic_year && (
                                <span className="text-[10px] text-[#71717A] font-medium">AY {hr.academic_year}</span>
                              )}
                            </div>

                            {/* Grade/section — desktop */}
                            <div className="hidden sm:block w-24 flex-shrink-0">
                              {homeroomGradeSectionBadge(hr) ? (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-[#F4F4F5] text-[#52525B] border border-[#D4D4D8]">
                                  {homeroomGradeSectionBadge(hr)}
                                </span>
                              ) : null}
                            </div>

                            {/* Expiry — desktop */}
                            <div className="hidden sm:flex items-center gap-1 w-32 flex-shrink-0">
                              {hr.expiry_date ? (
                                <>
                                  <Calendar size={10} className="text-[#A1A1AA] flex-shrink-0" />
                                  <span className="text-[11px] text-[#71717A]">
                                    {new Date(hr.expiry_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          {editingId === hr.id ? (
                            <>
                              <button onClick={handleSaveEdit} disabled={saving} className="p-1.5 text-[#27272A] hover:bg-[#E4E4E7] transition-colors disabled:opacity-50" title="Save">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              </button>
                              <button onClick={() => setEditingId(null)} className="p-1.5 text-[#71717A] hover:bg-[#E4E4E7] transition-colors" title="Cancel">
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => handleStartEdit(hr)} className="p-1.5 text-[#71717A] hover:text-[#27272A] hover:bg-[#E4E4E7] transition-colors" title="Edit">
                                <Edit3 size={14} />
                              </button>
                              <button onClick={() => handleDelete(hr.id)} className="p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Delete">
                                <Trash2 size={14} />
                              </button>
                              <button onClick={() => handleExpand(hr.id)} className="p-1.5 text-[#71717A] hover:bg-[#E4E4E7] transition-colors">
                                {expandedId === hr.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded: members */}
                    <AnimatePresence>
                      {expandedId === hr.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }} className="overflow-hidden"
                        >
                          <div className="border-b border-[#E4E4E7] bg-[#F5F5F5] px-5 py-4 space-y-4">
                            {/* Add student */}
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-2">Add Student or Smart Board by Email</label>
                              <div className="flex gap-2">
                                <input
                                  type="email" value={addEmail}
                                  onChange={e => setAddEmail(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMember() } }}
                                  placeholder="student@school.com or board@school.com"
                                  className="flex-1 border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors"
                                />
                                <button
                                  onClick={handleAddMember} disabled={addingMember || !addEmail.trim()}
                                  className="px-4 py-2 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {addingMember ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
                                </button>
                              </div>
                              {memberError && <p className="text-xs text-rose-600 mt-1">{memberError}</p>}
                            </div>

                            {/* Member list */}
                            {loadingExpanded ? (
                              <div className="text-center py-4">
                                <Loader2 size={16} className="animate-spin mx-auto mb-1 text-[#A1A1AA]" />
                                <p className="text-xs text-[#71717A]">Loading students…</p>
                              </div>
                            ) : expandedData?.members.length === 0 ? (
                              <div className="text-center py-5">
                                <Users size={24} className="mx-auto mb-1.5 text-[#D4D4D8]" />
                                <p className="text-sm text-[#71717A]">No students in this homeroom yet</p>
                              </div>
                            ) : (
                              <div className="space-y-px">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-2">
                                  Students ({expandedData?.members.length ?? 0})
                                </p>
                                {expandedData?.members.map(m => (
                                  <div key={m.id} className="flex items-center gap-3 py-2.5 px-3 bg-white border border-[#E4E4E7] hover:bg-[#EBEBEB] transition-colors group">
                                    <Avatar avatarUrl={m.student?.avatar_url} name={m.student?.full_name ?? ''} email={m.student?.email ?? ''} size={30} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-[#18181B] truncate">{m.student?.full_name}</p>
                                      <p className="text-xs text-[#71717A] truncate">{m.student?.email}</p>
                                    </div>
                                    {m.student?.grade && (
                                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-[#F4F4F5] text-[#52525B] border border-[#D4D4D8] flex-shrink-0">
                                        Gr.{m.student.grade}{m.student.section}
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleRemoveMember(m.student_id)}
                                      className="p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all"
                                      title="Remove from homeroom"
                                    >
                                      <UserMinus size={13} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Smart Board account */}
                            <div className="pt-3 border-t border-[#E4E4E7]">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] flex items-center gap-1.5">
                                  <MonitorPlay size={12} className="text-indigo-500" /> Smart Board Account
                                </p>
                                {smartboard && (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={handleUnlinkSmartboard}
                                      className="text-[10px] font-medium text-[#71717A] hover:text-[#27272A] flex items-center gap-1"
                                      title="Unlink but keep the account"
                                    >
                                      <X size={11} /> Unlink
                                    </button>
                                    <button
                                      onClick={handleRemoveSmartboard}
                                      className="text-[10px] font-medium text-rose-600 hover:text-rose-700 flex items-center gap-1"
                                      title="Delete the account"
                                    >
                                      <Trash2 size={11} /> Remove
                                    </button>
                                  </div>
                                )}
                              </div>

                              {loadingSmartboard ? (
                                <div className="flex items-center gap-2 text-xs text-[#71717A] py-2">
                                  <Loader2 size={13} className="animate-spin" /> Loading…
                                </div>
                              ) : smartboard ? (
                                <div className="flex items-center gap-3 py-2.5 px-3 bg-white border border-indigo-100 rounded-lg">
                                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
                                    <MonitorPlay size={15} className="text-white" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-[#18181B] truncate">{smartboard.full_name}</p>
                                    <p className="text-xs text-[#71717A] truncate">{smartboard.email}</p>
                                  </div>
                                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 flex-shrink-0">
                                    Board
                                  </span>
                                </div>
                              ) : showSbForm ? (
                                <div className="space-y-2 bg-white border border-[#E4E4E7] rounded-lg p-3">
                                  <div className="relative">
                                    <Mail size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
                                    <input
                                      type="email" value={sbEmail} onChange={e => setSbEmail(e.target.value)}
                                      placeholder="board.grade9a@school.com"
                                      className="w-full border border-[#D4D4D8] bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#27272A]"
                                    />
                                  </div>
                                  <input
                                    type="text" value={sbName} onChange={e => setSbName(e.target.value)}
                                    placeholder="Display name (e.g. Grade 9 A Board)"
                                    className="w-full border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A]"
                                  />
                                  <div className="relative">
                                    <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
                                    <input
                                      type="text" value={sbPassword} onChange={e => setSbPassword(e.target.value)}
                                      placeholder="Password (min 6 chars)"
                                      className="w-full border border-[#D4D4D8] bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#27272A]"
                                    />
                                  </div>
                                  {sbError && <p className="text-xs text-rose-600">{sbError}</p>}
                                  <div className="flex gap-2 pt-0.5">
                                    <button
                                      onClick={handleCreateSmartboard} disabled={sbCreating}
                                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50"
                                    >
                                      {sbCreating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create Account
                                    </button>
                                    <button onClick={() => { setShowSbForm(false); setSbError('') }} className="px-3 py-2 border border-[#D4D4D8] text-[#18181B] text-sm hover:bg-[#EBEBEB] transition-colors">
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : showSbLink ? (
                                <div className="space-y-2 bg-white border border-[#E4E4E7] rounded-lg p-3">
                                  <div className="relative">
                                    <Mail size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
                                    <input
                                      type="email" value={sbLinkEmail}
                                      onChange={e => setSbLinkEmail(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLinkSmartboard() } }}
                                      placeholder="Existing smart board email"
                                      className="w-full border border-[#D4D4D8] bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#27272A]"
                                    />
                                  </div>
                                  {sbError && <p className="text-xs text-rose-600">{sbError}</p>}
                                  <div className="flex gap-2 pt-0.5">
                                    <button
                                      onClick={handleLinkSmartboard} disabled={sbLinking || !sbLinkEmail.trim()}
                                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50"
                                    >
                                      {sbLinking ? <Loader2 size={13} className="animate-spin" /> : <MonitorPlay size={13} />} Link Account
                                    </button>
                                    <button onClick={() => { setShowSbLink(false); setSbError('') }} className="px-3 py-2 border border-[#D4D4D8] text-[#18181B] text-sm hover:bg-[#EBEBEB] transition-colors">
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => {
                                      setShowSbForm(true); setSbError('')
                                      setSbName(expandedData ? `${expandedData.name} Board` : '')
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-indigo-300 text-indigo-600 text-sm hover:bg-indigo-50 rounded-lg transition-colors"
                                  >
                                    <Plus size={13} /> Create new account
                                  </button>
                                  <button
                                    onClick={() => { setShowSbLink(true); setSbError('') }}
                                    className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-[#D4D4D8] text-[#52525B] text-sm hover:bg-[#EBEBEB] rounded-lg transition-colors"
                                  >
                                    <MonitorPlay size={13} /> Link existing account
                                  </button>
                                </div>
                              )}
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
      </div>
    </ProtectedLayout>
  )
}
