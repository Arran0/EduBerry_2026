'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import {
  Home,
  Plus,
  X,
  UserMinus,
  ChevronDown,
  ChevronUp,
  Edit3,
  Save,
  Loader2,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import { HOMEROOMS_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  Homeroom,
  HomeroomWithMembers,
  fetchAllHomerooms,
  createHomeroom,
  updateHomeroom,
  deleteHomeroom,
  fetchHomeroomWithMembers,
  addHomeroomMemberByEmail,
  removeHomeroomMember,
  homeroomGradeSectionBadge,
} from '@/lib/homerooms'

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1)
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F']

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
}

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

  // Create form
  const [newGrade, setNewGrade] = useState<number | ''>('')
  const [newSection, setNewSection] = useState('')
  const [newName, setNewName] = useState('')
  const [nameManual, setNameManual] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Member management
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

  // Auto-fill name when grade/section changes (unless manually edited)
  useEffect(() => {
    if (!nameManual) setNewName(autoName(newGrade, newSection))
  }, [newGrade, newSection, nameManual])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) { setCreateError('Name is required'); return }
    setCreating(true)
    setCreateError('')
    const result = await createHomeroom(
      name,
      newGrade || null,
      newSection || null,
      user?.id
    )
    if (result) {
      setNewGrade('')
      setNewSection('')
      setNewName('')
      setNameManual(false)
      setShowCreateForm(false)
      await loadHomerooms()
    } else {
      setCreateError('Failed to create homeroom')
    }
    setCreating(false)
  }

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setExpandedData(null)
      setEditingId(null)
      return
    }
    setExpandedId(id)
    setExpandedData(null)
    setLoadingExpanded(true)
    setMemberError('')
    setAddEmail('')
    const data = await fetchHomeroomWithMembers(id)
    setExpandedData(data)
    setLoadingExpanded(false)
  }

  const handleStartEdit = (hr: Homeroom) => {
    setEditingId(hr.id)
    setEditForm({ name: hr.name, grade: hr.grade ?? '', section: hr.section ?? '' })
    setEditNameManual(true)
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    await updateHomeroom(
      editingId,
      editForm.name.trim() || autoName(editForm.grade, editForm.section),
      editForm.grade || null,
      editForm.section || null
    )
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
    setAddingMember(true)
    setMemberError('')
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
      <div data-page-theme="more">
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
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-medium text-sm rounded-xl border border-white/30 transition-colors"
              >
                {showCreateForm ? <X size={15} /> : <Plus size={15} />}
                {showCreateForm ? 'Cancel' : 'New Homeroom'}
              </button>
              <button
                onClick={() => setShowCreateForm(p => !p)}
                className="sm:hidden w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center text-white transition-colors"
              >
                {showCreateForm ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          ) : undefined}
        />

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

          {/* ── Create Form ── */}
          <AnimatePresence>
            {showCreateForm && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-teal-50 to-cyan-50">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-teal-100 rounded-lg">
                      <Home size={15} className="text-teal-600" />
                    </div>
                    <h3 className="font-semibold text-slate-800 text-sm">New Homeroom</h3>
                  </div>
                  <button type="button" onClick={() => setShowCreateForm(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white/80 rounded-lg transition-colors">
                    <X size={15} />
                  </button>
                </div>

                <form onSubmit={handleCreate} className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Grade</label>
                      <select
                        value={newGrade}
                        onChange={e => { setNewGrade(e.target.value ? Number(e.target.value) : ''); setNameManual(false) }}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400 bg-slate-50 focus:bg-white transition-colors"
                      >
                        <option value="">— optional —</option>
                        {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Section</label>
                      <select
                        value={newSection}
                        onChange={e => { setNewSection(e.target.value); setNameManual(false) }}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400 bg-slate-50 focus:bg-white transition-colors"
                      >
                        <option value="">— optional —</option>
                        {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">
                      Homeroom Name *
                      {!nameManual && newName && (
                        <span className="ml-2 text-teal-600 font-normal normal-case">auto-filled</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={e => { setNewName(e.target.value); setNameManual(true) }}
                      placeholder="e.g. Grade 7 Section A or Sunrise Batch"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400 bg-slate-50 focus:bg-white transition-colors"
                      required
                    />
                    {createError && <p className="text-xs text-rose-500 mt-1">{createError}</p>}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button type="submit" disabled={creating} className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50 bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-medium text-sm py-2.5 px-4 rounded-xl transition-all">
                      {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      Create Homeroom
                    </button>
                    <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Search ── */}
          {!loading && homerooms.length > 0 && (
            <div className="mb-4 relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-slate-200 rounded-xl pl-10 pr-9 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300 shadow-sm transition-colors"
                placeholder="Search homerooms by name, grade, or section…"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5">
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {/* ── List ── */}
          {loading ? (
            <div className="text-center py-16">
              <div className="spinner mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading homerooms…</p>
            </div>
          ) : homerooms.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
              <Home size={44} className="text-slate-200 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 mb-1">No homerooms yet</h3>
              <p className="text-sm text-slate-400 mb-5">Create your first homeroom to start tracking attendance.</p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-medium text-sm rounded-xl shadow-sm hover:shadow-md transition-all"
              >
                <Plus size={15} />
                Create Homeroom
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
              <p className="text-sm text-slate-400">No homerooms match &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
            <motion.div
              className="flex flex-col gap-3"
              variants={containerVariants}
              initial="hidden"
              animate="show"
            >
              {filtered.map(hr => (
                <motion.div key={hr.id} variants={itemVariants} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

                  {/* ── Card Header ── */}
                  <div className="flex items-center gap-3 px-5 py-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
                      <Home size={18} className="text-white" />
                    </div>

                    {editingId === hr.id ? (
                      /* ── Inline Edit ── */
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                          placeholder="Homeroom name"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={editForm.grade}
                            onChange={e => setEditForm(f => ({ ...f, grade: e.target.value ? Number(e.target.value) : '' }))}
                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                          >
                            <option value="">No grade</option>
                            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                          </select>
                          <select
                            value={editForm.section}
                            onChange={e => setEditForm(f => ({ ...f, section: e.target.value }))}
                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                          >
                            <option value="">No section</option>
                            {SECTIONS.map(s => <option key={s} value={s}>Section {s}</option>)}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800 text-sm">{hr.name}</span>
                          {homeroomGradeSectionBadge(hr) && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-medium border border-teal-100">
                              {homeroomGradeSectionBadge(hr)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-1 flex-shrink-0">
                      {editingId === hr.id ? (
                        <>
                          <button
                            onClick={handleSaveEdit}
                            disabled={saving}
                            className="p-2 text-teal-600 hover:bg-teal-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Save"
                          >
                            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Cancel"
                          >
                            <X size={15} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleStartEdit(hr)}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(hr.id)}
                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                          <button
                            onClick={() => handleExpand(hr.id)}
                            className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            {expandedId === hr.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── Expanded: Members ── */}
                  <AnimatePresence>
                    {expandedId === hr.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-slate-100"
                      >
                        <div className="px-5 py-4 space-y-4">
                          {/* Add student */}
                          <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Add Student by Email</label>
                            <div className="flex gap-2">
                              <input
                                type="email"
                                value={addEmail}
                                onChange={e => setAddEmail(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMember() } }}
                                placeholder="student@school.com"
                                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400"
                              />
                              <button
                                onClick={handleAddMember}
                                disabled={addingMember || !addEmail.trim()}
                                className="px-4 py-2 bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-medium text-sm rounded-xl hover:from-teal-600 hover:to-cyan-700 disabled:opacity-50 transition-all flex items-center gap-1.5"
                              >
                                {addingMember ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                Add
                              </button>
                            </div>
                            {memberError && <p className="text-xs text-rose-500 mt-1">{memberError}</p>}
                          </div>

                          {/* Member list */}
                          {loadingExpanded ? (
                            <div className="text-center py-4">
                              <div className="spinner mx-auto mb-2" />
                              <p className="text-xs text-slate-400">Loading students…</p>
                            </div>
                          ) : expandedData?.members.length === 0 ? (
                            <div className="text-center py-6 text-slate-400">
                              <Users size={28} className="mx-auto mb-2 opacity-40" />
                              <p className="text-sm">No students in this homeroom yet</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                Students ({expandedData?.members.length ?? 0})
                              </p>
                              {expandedData?.members.map(m => (
                                <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors group">
                                  <Avatar
                                    avatarUrl={m.student?.avatar_url}
                                    name={m.student?.full_name ?? ''}
                                    email={m.student?.email ?? ''}
                                    size={32}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-800 truncate">{m.student?.full_name}</p>
                                    <p className="text-xs text-slate-400 truncate">{m.student?.email}</p>
                                  </div>
                                  {m.student?.grade && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium flex-shrink-0">
                                      Gr.{m.student.grade}{m.student.section}
                                    </span>
                                  )}
                                  <button
                                    onClick={() => handleRemoveMember(m.student_id)}
                                    className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
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
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
