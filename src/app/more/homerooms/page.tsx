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
} from 'lucide-react'
import { HOMEROOMS_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  Homeroom, HomeroomWithMembers,
  fetchAllHomerooms, createHomeroom, updateHomeroom, deleteHomeroom,
  fetchHomeroomWithMembers, addHomeroomMemberByEmail, removeHomeroomMember,
  homeroomGradeSectionBadge,
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

const ai = 'border border-[#C9C3BB] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors w-full'
const aiSm = 'border border-[#C9C3BB] bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors'

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
    const data = await fetchHomeroomWithMembers(id)
    setExpandedData(data); setLoadingExpanded(false)
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
      const updated = await fetchHomeroomWithMembers(expandedId)
      setExpandedData(updated)
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
      <div data-page-theme="admin">
        <PageBanner
          settingKey="homerooms_banner"
          defaultBanner={HOMEROOMS_BANNER_DEFAULT}
          icon={<Home size={26} className="text-white" />}
          title="Homeroom Manager"
          subtitle="Create and manage homerooms for attendance"
          isAdmin={isAdmin}
          onBack={() => router.back()}
          maxWidth="max-w-4xl"
          actions={isAdmin ? (
            <>
              <button
                onClick={() => setShowCreateForm(p => !p)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-[#A8896B]/80 hover:bg-[#A8896B] text-white text-sm font-medium border border-[#A8896B] transition-colors"
              >
                {showCreateForm ? <X size={15} /> : <Plus size={15} />}
                {showCreateForm ? 'Cancel' : 'New Homeroom'}
              </button>
              <button
                onClick={() => setShowCreateForm(p => !p)}
                className="sm:hidden w-10 h-10 bg-[#A8896B]/80 hover:bg-[#A8896B] border border-[#A8896B] flex items-center justify-center text-white transition-colors"
              >
                {showCreateForm ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          ) : undefined}
        />

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

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
                    : 'bg-[#F3F0EB] border-[#C9C3BB] text-[#2B292E]'
                }`}
              >
                <CheckCircle2 size={15} className={`flex-shrink-0 mt-0.5 ${syncResult.apiError ? 'text-rose-400' : syncResult.total === 0 ? 'text-amber-400' : 'text-[#A8896B]'}`} />
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
                className="mb-3 border border-[#C9C3BB] border-l-4 border-l-[#A8896B] bg-[#F3F0EB] overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#C9C3BB] bg-[#3D3B40]">
                  <span className="text-sm font-bold text-[#F3F0EB]">New Homeroom</span>
                  <button type="button" onClick={() => setShowCreateForm(false)} className="text-[#F3F0EB]/60 hover:text-[#F3F0EB] transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleCreate} className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">Grade</label>
                      <select value={newGrade} onChange={e => { setNewGrade(e.target.value ? Number(e.target.value) : ''); setNameManual(false) }} className={ai}>
                        <option value="">— optional —</option>
                        {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">Section</label>
                      <select value={newSection} onChange={e => { setNewSection(e.target.value); setNameManual(false) }} className={ai}>
                        <option value="">— optional —</option>
                        {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">
                      Homeroom Name *
                      {!nameManual && newName && <span className="ml-2 text-[#A8896B] font-normal normal-case">auto-filled</span>}
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
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">
                      Expiry Date <span className="text-[#9A9290] font-normal normal-case">(optional)</span>
                    </label>
                    <input type="date" value={newExpiryDate} onChange={e => setNewExpiryDate(e.target.value)} className={ai} />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="submit" disabled={creating} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] text-sm font-medium transition-colors disabled:opacity-50">
                      {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                      Create Homeroom
                    </button>
                    <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2.5 border border-[#C9C3BB] text-[#2B292E] text-sm hover:bg-[#EAE6E0] transition-colors">
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
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A7572] pointer-events-none" />
                  <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    className="w-full border border-[#C9C3BB] bg-white pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors placeholder:text-[#9A9290]"
                    placeholder="Search by name, grade, or section…"
                  />
                  {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7A7572] hover:text-[#3D3B40]"><X size={13} /></button>}
                </div>
              )}
              {isAdmin && (
                <button
                  onClick={handleSync} disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#C9C3BB] text-sm font-medium text-[#2B292E] hover:bg-[#EAE6E0] hover:border-[#A8896B] transition-colors disabled:opacity-50 whitespace-nowrap"
                  title="Auto-enroll students into homerooms"
                >
                  {syncing ? <Loader2 size={13} className="animate-spin text-[#A8896B]" /> : <RefreshCw size={13} className="text-[#A8896B]" />}
                  {syncing ? 'Syncing…' : 'Sync Students'}
                </button>
              )}
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="border border-[#C9C3BB] bg-[#F3F0EB] py-16 text-center">
              <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A8896B]" />
              <p className="text-sm text-[#7A7572]">Loading homerooms…</p>
            </div>
          ) : homerooms.length === 0 ? (
            <div className="border border-[#C9C3BB] bg-[#F3F0EB] p-12 text-center">
              <Home size={36} className="text-[#C9C3BB] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#2B292E] mb-1">No homerooms yet</p>
              <p className="text-sm text-[#7A7572] mb-5">Create your first homeroom to start tracking attendance.</p>
              <button onClick={() => setShowCreateForm(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] text-sm font-medium transition-colors mx-auto">
                <Plus size={14} /> Create Homeroom
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="border border-[#C9C3BB] bg-[#F3F0EB] p-10 text-center">
              <p className="text-sm text-[#7A7572]">No homerooms match &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
            <div className="border border-[#C9C3BB] overflow-hidden">
              {/* Column headers */}
              <div className="bg-[#3D3B40] px-4 py-2.5 hidden sm:flex items-center gap-3">
                <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A8896B]">Name</span>
                <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A8896B] flex-shrink-0">Grade/Section</span>
                <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A8896B] flex-shrink-0">Expiry</span>
                <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A8896B] text-right flex-shrink-0">Actions</span>
              </div>

              <motion.div variants={containerVariants} initial="hidden" animate="show">
                {filtered.map(hr => (
                  <motion.div key={hr.id} variants={itemVariants}>
                    {/* Row */}
                    <div className="flex items-stretch border-b border-[#E0DCD6] last:border-b-0 hover:bg-[#EAE6E0] transition-colors">
                      <div className="w-1 flex-shrink-0 bg-[#A8896B]" />
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
                              <p className="text-sm font-semibold text-[#2B292E] truncate">{hr.name}</p>
                              {hr.academic_year && (
                                <span className="text-[10px] text-[#A8896B] font-medium">AY {hr.academic_year}</span>
                              )}
                            </div>

                            {/* Grade/section — desktop */}
                            <div className="hidden sm:block w-24 flex-shrink-0">
                              {homeroomGradeSectionBadge(hr) ? (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-[#A8896B]/10 text-[#8B7257] border border-[#A8896B]/30">
                                  {homeroomGradeSectionBadge(hr)}
                                </span>
                              ) : null}
                            </div>

                            {/* Expiry — desktop */}
                            <div className="hidden sm:flex items-center gap-1 w-32 flex-shrink-0">
                              {hr.expiry_date ? (
                                <>
                                  <Calendar size={10} className="text-[#9A9290] flex-shrink-0" />
                                  <span className="text-[11px] text-[#7A7572]">
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
                              <button onClick={handleSaveEdit} disabled={saving} className="p-1.5 text-[#A8896B] hover:bg-[#E0DCD6] transition-colors disabled:opacity-50" title="Save">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              </button>
                              <button onClick={() => setEditingId(null)} className="p-1.5 text-[#7A7572] hover:bg-[#E0DCD6] transition-colors" title="Cancel">
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => handleStartEdit(hr)} className="p-1.5 text-[#7A7572] hover:text-[#3D3B40] hover:bg-[#E0DCD6] transition-colors" title="Edit">
                                <Edit3 size={14} />
                              </button>
                              <button onClick={() => handleDelete(hr.id)} className="p-1.5 text-[#7A7572] hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Delete">
                                <Trash2 size={14} />
                              </button>
                              <button onClick={() => handleExpand(hr.id)} className="p-1.5 text-[#7A7572] hover:bg-[#E0DCD6] transition-colors">
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
                          <div className="border-b border-[#E0DCD6] bg-[#F3F0EB] px-5 py-4 space-y-4">
                            {/* Add student */}
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-2">Add Student by Email</label>
                              <div className="flex gap-2">
                                <input
                                  type="email" value={addEmail}
                                  onChange={e => setAddEmail(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMember() } }}
                                  placeholder="student@school.com"
                                  className="flex-1 border border-[#C9C3BB] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors"
                                />
                                <button
                                  onClick={handleAddMember} disabled={addingMember || !addEmail.trim()}
                                  className="px-4 py-2 bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {addingMember ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
                                </button>
                              </div>
                              {memberError && <p className="text-xs text-rose-600 mt-1">{memberError}</p>}
                            </div>

                            {/* Member list */}
                            {loadingExpanded ? (
                              <div className="text-center py-4">
                                <Loader2 size={16} className="animate-spin mx-auto mb-1 text-[#A8896B]" />
                                <p className="text-xs text-[#7A7572]">Loading students…</p>
                              </div>
                            ) : expandedData?.members.length === 0 ? (
                              <div className="text-center py-5">
                                <Users size={24} className="mx-auto mb-1.5 text-[#C9C3BB]" />
                                <p className="text-sm text-[#7A7572]">No students in this homeroom yet</p>
                              </div>
                            ) : (
                              <div className="space-y-px">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-2">
                                  Students ({expandedData?.members.length ?? 0})
                                </p>
                                {expandedData?.members.map(m => (
                                  <div key={m.id} className="flex items-center gap-3 py-2.5 px-3 bg-white border border-[#E0DCD6] hover:bg-[#EAE6E0] transition-colors group">
                                    <Avatar avatarUrl={m.student?.avatar_url} name={m.student?.full_name ?? ''} email={m.student?.email ?? ''} size={30} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-[#2B292E] truncate">{m.student?.full_name}</p>
                                      <p className="text-xs text-[#7A7572] truncate">{m.student?.email}</p>
                                    </div>
                                    {m.student?.grade && (
                                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-[#A8896B]/10 text-[#8B7257] border border-[#A8896B]/30 flex-shrink-0">
                                        Gr.{m.student.grade}{m.student.section}
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleRemoveMember(m.student_id)}
                                      className="p-1.5 text-[#7A7572] hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all"
                                      title="Remove from homeroom"
                                    >
                                      <UserMinus size={13} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
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
