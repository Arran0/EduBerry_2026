'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import UserEmailSuggest from '@/components/UserEmailSuggest'
import { useAuth } from '@/contexts/AuthContext'
import PageBanner from '@/components/PageBanner'
import { useRouter } from 'next/navigation'
import {
  Users, Plus, X, UserMinus, ChevronDown, ChevronUp,
  Calendar, Edit3, Trash2, Save, Loader2, Search, CalendarX, Clock, Crown,
} from 'lucide-react'
import { TEAMS_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  TeamWithDetails, fetchAllTeams, createTeam, updateTeam, deleteTeam,
  addTeamMemberByEmail, removeTeamMember, addTeamCoordinator, removeTeamCoordinator,
} from '@/lib/teams'

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.025 } },
}
const itemVariants = { hidden: { opacity: 0 }, show: { opacity: 1 } }

const ai = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'
const aiSm = 'border border-[#D4D4D8] bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors'

const ROLE_BADGE: Record<string, string> = {
  admin:       'bg-rose-50 text-rose-700 border-rose-200',
  principal:   'bg-violet-50 text-violet-700 border-violet-200',
  coordinator: 'bg-blue-50 text-blue-700 border-blue-200',
  teacher:     'bg-teal-50 text-teal-700 border-teal-200',
  student:     'bg-[#F4F4F5] text-[#52525B] border-[#D4D4D8]',
}

export default function TeacherTeamsPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile?.role === 'admin'

  const [teams, setTeams] = useState<TeamWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [editingTeam, setEditingTeam] = useState<string | null>(null)
  const [bannerEditing, setBannerEditing] = useState(false)
  const [showMembersTeams, setShowMembersTeams] = useState<Set<string>>(new Set())

  const [newTeam, setNewTeam] = useState({ name: '', description: '', start_date: '', end_date: '', coordinator_email: '' })
  const [creating, setCreating] = useState(false)

  const [addMemberEmail, setAddMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [memberError, setMemberError] = useState('')

  const [editForm, setEditForm] = useState({ name: '', description: '', start_date: '', end_date: '' })
  const [saving, setSaving] = useState(false)

  const [teamSearch, setTeamSearch] = useState('')
  const [expiredSearch, setExpiredSearch] = useState('')
  const [showExpiredSection, setShowExpiredSection] = useState(false)

  const loadTeams = useCallback(async () => {
    setLoading(true)
    const data = await fetchAllTeams()
    setTeams(data)
    setLoading(false)
  }, [])

  useEffect(() => { loadTeams() }, [loadTeams])

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTeam.name.trim()) return
    setCreating(true)
    const result = await createTeam({
      name: newTeam.name.trim(),
      description: newTeam.description.trim() || undefined,
      start_date: newTeam.start_date || undefined,
      end_date: newTeam.end_date || undefined,
      coordinator_email: newTeam.coordinator_email.trim() || undefined,
    })
    if (result) {
      setNewTeam({ name: '', description: '', start_date: '', end_date: '', coordinator_email: '' })
      setShowCreateForm(false)
      await loadTeams()
    }
    setCreating(false)
  }

  const handleAddMember = async (teamId: string) => {
    if (!addMemberEmail.trim()) return
    setAddingMember(teamId); setMemberError('')
    const result = await addTeamMemberByEmail(teamId, addMemberEmail.trim())
    if (result.success) {
      setAddMemberEmail('')
      await loadTeams()
    } else {
      setMemberError(result.error || 'Failed to add member')
    }
    setAddingMember(null)
  }

  const handleRemoveMember = async (teamId: string, userId: string) => {
    await removeTeamMember(teamId, userId)
    await loadTeams()
  }

  const handleStartEdit = (team: TeamWithDetails) => {
    setEditingTeam(team.id)
    setEditForm({
      name: team.name,
      description: team.description || '',
      start_date: team.start_date || '',
      end_date: team.end_date || '',
    })
  }

  const handleSaveEdit = async (teamId: string) => {
    setSaving(true)
    await updateTeam(teamId, {
      name: editForm.name.trim(),
      description: editForm.description.trim() || null,
      start_date: editForm.start_date || null,
      end_date: editForm.end_date || null,
    })
    setEditingTeam(null)
    await loadTeams()
    setSaving(false)
  }

  const handleExpireTeam = async (teamId: string) => {
    const today = new Date().toISOString().split('T')[0]
    await updateTeam(teamId, { end_date: today })
    await loadTeams()
  }

  const handleSetCoordinator = async (teamId: string, userId: string) => {
    await addTeamCoordinator(teamId, userId)
    await loadTeams()
  }

  const handleRemoveCoordinator = async (teamId: string, userId: string) => {
    await removeTeamCoordinator(teamId, userId)
    await loadTeams()
  }

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm('Are you sure you want to delete this team?')) return
    await deleteTeam(teamId)
    await loadTeams()
  }

  if (!user || !profile) return null

  const today = new Date().toISOString().split('T')[0]
  const isTeamExpired = (t: TeamWithDetails) => !!(t.end_date && t.end_date < today)

  const searchLower = teamSearch.trim().toLowerCase()
  const activeTeams = teams.filter(t => !isTeamExpired(t))
  const filteredTeams = searchLower ? activeTeams.filter(t => t.name.toLowerCase().includes(searchLower) || (t.description && t.description.toLowerCase().includes(searchLower))) : activeTeams

  const expiredTeams = teams.filter(t => isTeamExpired(t)).sort((a, b) => (b.end_date! > a.end_date! ? 1 : -1))
  const expiredSearchLower = expiredSearch.trim().toLowerCase()
  const filteredExpiredTeams = expiredSearchLower
    ? expiredTeams.filter(t => t.name.toLowerCase().includes(expiredSearchLower) || (t.description && t.description.toLowerCase().includes(expiredSearchLower)))
    : expiredTeams.slice(0, 5)

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ backgroundColor: '#FDFCF9', minHeight: '100vh' }}>
        <PageBanner
          settingKey="teams_banner"
          defaultBanner={TEAMS_BANNER_DEFAULT}
          icon={<Users size={26} className="text-white" />}
          title="Teacher Teams"
          subtitle="Manage teacher teams and coordinators"
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
                {showCreateForm ? 'Cancel' : 'Create Team'}
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

          {/* Create form */}
          <AnimatePresence>
            {showCreateForm && (
              <motion.div
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="mb-3 border border-[#D4D4D8] border-l-4 border-l-[#525252] bg-[#F5F5F5] rounded-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#D4D4D8] bg-[#27272A]">
                  <span className="text-sm font-bold text-[#F5F5F5]">New Teacher Team</span>
                  <button type="button" onClick={() => setShowCreateForm(false)} className="text-[#F5F5F5]/60 hover:text-[#F5F5F5] transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleCreateTeam} className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Team Name *</label>
                      <input type="text" value={newTeam.name} onChange={e => setNewTeam({ ...newTeam, name: e.target.value })} className={ai} placeholder="e.g., Science Department" required />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Coordinator Email</label>
                      <UserEmailSuggest
                        value={newTeam.coordinator_email} onChange={v => setNewTeam({ ...newTeam, coordinator_email: v })}
                        roles={['coordinator', 'principal', 'admin']} placeholder="coordinator@school.com" className={ai}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Description</label>
                    <textarea value={newTeam.description} onChange={e => setNewTeam({ ...newTeam, description: e.target.value })} className={`${ai} resize-none`} rows={2} placeholder="Brief description…" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Start Date</label>
                      <input type="date" value={newTeam.start_date} onChange={e => setNewTeam({ ...newTeam, start_date: e.target.value })} className={ai} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">End Date</label>
                      <input type="date" value={newTeam.end_date} onChange={e => setNewTeam({ ...newTeam, end_date: e.target.value })} className={ai} />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="submit" disabled={creating} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50">
                      {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                      Create Team
                    </button>
                    <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm hover:bg-[#EBEBEB] transition-colors">Cancel</button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search bar */}
          {!loading && teams.length > 0 && (
            <div className="mb-3 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
              <input
                type="text" value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                className="w-full border border-[#D4D4D8] bg-white pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors placeholder:text-[#A1A1AA] rounded-xl shadow-lg"
                placeholder="Search teams by name…"
              />
              {teamSearch && <button onClick={() => setTeamSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A]"><X size={13} /></button>}
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] py-16 text-center">
              <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A1A1AA]" />
              <p className="text-sm text-[#71717A]">Loading teams…</p>
            </div>
          ) : teams.length === 0 ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] p-12 text-center">
              <Users size={36} className="text-[#D4D4D8] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#18181B] mb-1">No Teams Yet</p>
              <p className="text-sm text-[#71717A] mb-5">Create your first teacher team to get started.</p>
              {isAdmin && (
                <button onClick={() => setShowCreateForm(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors mx-auto">
                  <Plus size={14} /> Create Team
                </button>
              )}
            </div>
          ) : filteredTeams.length === 0 && activeTeams.length > 0 ? (
            <div className="border border-[#D4D4D8] bg-[#F5F5F5] p-10 text-center">
              <p className="text-sm text-[#71717A]">No teams match &ldquo;{teamSearch}&rdquo;</p>
            </div>
          ) : (
            <>
              {(filteredTeams.length > 0 || (activeTeams.length === 0 && expiredTeams.length > 0)) && filteredTeams.length > 0 && (
                <div className="border border-[#D4D4D8] rounded-xl overflow-hidden mb-3">
                  {/* Column headers */}
                  <div className="bg-[#27272A] px-4 py-2.5 hidden sm:flex items-center gap-3">
                    <span className="w-8 flex-shrink-0" />
                    <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Name</span>
                    <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Coordinator</span>
                    <span className="w-20 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Members</span>
                    <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Dates</span>
                    <span className="w-28 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                  </div>

                  <motion.div variants={containerVariants} initial="hidden" animate="show">
                    {filteredTeams.map(team => (
                      <TeamRow
                        key={team.id}
                        team={team}
                        isAdmin={isAdmin}
                        expanded={expandedTeam === team.id}
                        addMemberEmail={addMemberEmail}
                        addingMember={addingMember}
                        memberError={memberError}
                        showMembers={showMembersTeams.has(team.id)}
                        onExpand={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
                        onStartEdit={() => handleStartEdit(team)}
                        onExpire={() => handleExpireTeam(team.id)}
                        onAddMemberEmailChange={v => { setAddMemberEmail(v); setMemberError('') }}
                        onAddMember={() => handleAddMember(team.id)}
                        onRemoveMember={uid => handleRemoveMember(team.id, uid)}
                        onSetCoordinator={uid => handleSetCoordinator(team.id, uid)}
                        onRemoveCoordinator={uid => handleRemoveCoordinator(team.id, uid)}
                        onDelete={() => handleDeleteTeam(team.id)}
                        onToggleMembers={() => setShowMembersTeams(prev => { const next = new Set(prev); next.has(team.id) ? next.delete(team.id) : next.add(team.id); return next })}
                      />
                    ))}
                  </motion.div>
                </div>
              )}

              {/* Expired Teams section */}
              {expiredTeams.length > 0 && (
                <div className="border border-[#D4D4D8] rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowExpiredSection(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-[#3F3F46] hover:bg-[#52525B] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <CalendarX size={13} className="text-[#A1A1AA]" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Expired Teams</span>
                      <span className="text-[10px] text-[#71717A] font-medium">{expiredTeams.length}</span>
                    </div>
                    <ChevronDown size={13} className={`text-[#71717A] transition-transform ${showExpiredSection ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {showExpiredSection && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }} className="overflow-hidden"
                      >
                        {/* Expired search */}
                        <div className="px-4 pt-3 pb-2 bg-[#F5F5F5] border-b border-[#E4E4E7]">
                          <div className="relative">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
                            <input
                              type="text" value={expiredSearch} onChange={e => setExpiredSearch(e.target.value)}
                              className="w-full border border-[#D4D4D8] bg-white pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors placeholder:text-[#A1A1AA]"
                              placeholder="Search expired teams…"
                            />
                            {expiredSearch && (
                              <button onClick={() => setExpiredSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A]">
                                <X size={12} />
                              </button>
                            )}
                          </div>
                          {!expiredSearch && expiredTeams.length > 5 && (
                            <p className="text-[10px] text-[#A1A1AA] mt-1.5">Showing 5 most recently expired · search to find others</p>
                          )}
                        </div>

                        {filteredExpiredTeams.length === 0 ? (
                          <div className="px-4 py-6 text-center bg-[#F5F5F5]">
                            <p className="text-sm text-[#71717A]">No expired teams match &ldquo;{expiredSearch}&rdquo;</p>
                          </div>
                        ) : (
                          <motion.div variants={containerVariants} initial="hidden" animate="show" className="bg-[#F5F5F5]">
                            {filteredExpiredTeams.map(team => (
                              <TeamRow
                                key={team.id}
                                team={team}
                                isAdmin={isAdmin}
                                expired
                                expanded={expandedTeam === team.id}
                                addMemberEmail={addMemberEmail}
                                addingMember={addingMember}
                                memberError={memberError}
                                showMembers={showMembersTeams.has(team.id)}
                                onExpand={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
                                onStartEdit={() => handleStartEdit(team)}
                                onExpire={() => {}}
                                onAddMemberEmailChange={v => { setAddMemberEmail(v); setMemberError('') }}
                                onAddMember={() => handleAddMember(team.id)}
                                onRemoveMember={uid => handleRemoveMember(team.id, uid)}
                                onSetCoordinator={uid => handleSetCoordinator(team.id, uid)}
                        onRemoveCoordinator={uid => handleRemoveCoordinator(team.id, uid)}
                                onDelete={() => handleDeleteTeam(team.id)}
                                onToggleMembers={() => setShowMembersTeams(prev => { const next = new Set(prev); next.has(team.id) ? next.delete(team.id) : next.add(team.id); return next })}
                              />
                            ))}
                          </motion.div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editingTeam && createPortal(
        <AnimatePresence>
          <motion.div
            key="team-edit-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            onClick={() => setEditingTeam(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.18 }}
              className="bg-white shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] rounded-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
                <h2 className="text-base font-semibold text-white">Edit Team</h2>
                <button onClick={() => setEditingTeam(null)} className="text-white/60 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Team Name *</label>
                  <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className={ai} placeholder="e.g., Science Department" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Description</label>
                  <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className={`${ai} resize-none`} rows={2} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Start Date</label>
                    <input type="date" value={editForm.start_date} onChange={e => setEditForm({ ...editForm, start_date: e.target.value })} className={ai} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">End Date</label>
                    <input type="date" value={editForm.end_date} onChange={e => setEditForm({ ...editForm, end_date: e.target.value })} className={ai} />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 px-6 py-4 border-t border-[#E4E4E7] flex-shrink-0">
                <button
                  onClick={() => handleSaveEdit(editingTeam)} disabled={saving || !editForm.name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Save Changes
                </button>
                <button onClick={() => setEditingTeam(null)} className="px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F5F5F5] transition-colors">
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

// ── TeamRow sub-component ────────────────────────────────────────────────────

interface EditFormState {
  name: string; description: string; start_date: string; end_date: string
}

interface TeamRowProps {
  team: TeamWithDetails
  isAdmin: boolean; expired?: boolean; expanded: boolean
  addMemberEmail: string; addingMember: string | null; memberError: string
  showMembers: boolean
  onExpand: () => void; onStartEdit: () => void
  onExpire: () => void
  onAddMemberEmailChange: (v: string) => void; onAddMember: () => void
  onRemoveMember: (userId: string) => void; onSetCoordinator: (userId: string) => void
  onRemoveCoordinator: (userId: string) => void
  onDelete: () => void; onToggleMembers: () => void
}

function TeamRow({
  team, isAdmin, expired = false, expanded,
  addMemberEmail, addingMember, memberError, showMembers,
  onExpand, onStartEdit,
  onExpire, onAddMemberEmailChange, onAddMember, onRemoveMember, onSetCoordinator, onRemoveCoordinator, onDelete, onToggleMembers,
}: TeamRowProps) {
  return (
    <motion.div variants={itemVariants}>
      {/* Row */}
      <div
        className={`flex items-stretch border-b border-[#E4E4E7] last:border-b-0 hover:bg-[#EBEBEB] transition-colors cursor-pointer ${expired ? 'opacity-60' : ''}`}
        onClick={onExpand}
      >
        <div className={`w-1 flex-shrink-0 ${expired ? 'bg-[#A1A1AA]' : 'bg-[#D4D4D8]'}`} />
        <div className="flex items-center gap-3 flex-1 px-4 py-3 min-w-0">

          {/* Initials avatar */}
          <div className={`w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-white text-sm font-bold ${expired ? 'bg-[#71717A]' : 'bg-[#27272A]'}`}>
            {team.name.charAt(0).toUpperCase()}
          </div>

          {/* Name */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold truncate ${expired ? 'text-[#71717A]' : 'text-[#18181B]'}`}>{team.name}</p>
            {team.description && <p className="hidden sm:block text-xs text-[#71717A] truncate">{team.description}</p>}
          </div>

          {/* Coordinators — desktop */}
          <div className="hidden sm:block w-32 flex-shrink-0 min-w-0">
            {team.coordinators.length > 0 ? (
              <span
                className="text-xs text-[#71717A] truncate block"
                title={team.coordinators.map(c => c.full_name).join(', ')}
              >
                {team.coordinators[0].full_name}
                {team.coordinators.length > 1 ? ` +${team.coordinators.length - 1}` : ''}
              </span>
            ) : null}
          </div>

          {/* Member count — desktop */}
          <span className="hidden sm:block text-xs text-[#71717A] w-20 flex-shrink-0">
            {team.member_count} member{team.member_count !== 1 ? 's' : ''}
          </span>

          {/* Dates — desktop */}
          <div className="hidden sm:flex items-center gap-1 w-24 flex-shrink-0 min-w-0">
            {team.start_date ? (
              <span className="text-[11px] text-[#71717A] truncate">
                {new Date(team.start_date).getFullYear()}
                {team.end_date ? `–${new Date(team.end_date).getFullYear()}` : ''}
              </span>
            ) : team.end_date ? (
              <span className="text-[11px] text-[#71717A] truncate">–{new Date(team.end_date).getFullYear()}</span>
            ) : null}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 w-28 justify-end flex-shrink-0">
            {isAdmin && (
              <>
                {!expired && (
                  <button
                    onClick={e => { e.stopPropagation(); onExpire() }}
                    className="p-1.5 text-[#71717A] hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    title="Mark as expired (set end date to today)"
                  >
                    <Clock size={14} />
                  </button>
                )}
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
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }} className="overflow-hidden"
          >
            <div className="border-b border-[#E4E4E7] bg-[#F5F5F5] px-5 py-4 space-y-3">
              {/* Add member */}
              {isAdmin && !expired && (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <UserEmailSuggest
                      value={addMemberEmail} onChange={v => { onAddMemberEmailChange(v) }}
                      roles={['teacher', 'coordinator', 'principal', 'admin']}
                      placeholder="Add member by email…"
                      className="border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full"
                    />
                  </div>
                  <button
                    onClick={onAddMember} disabled={addingMember === team.id}
                    className="px-4 py-2 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {addingMember === team.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Add
                  </button>
                </div>
              )}
              {memberError && <p className="text-xs text-rose-600">{memberError}</p>}

              {/* Members toggle */}
              <button
                type="button"
                onClick={onToggleMembers}
                className="w-full flex items-center justify-between py-2 px-3 bg-white border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#525252]">
                  <Users size={12} /> Members
                  <span className="font-normal text-[#71717A] normal-case">({team.members.length})</span>
                </span>
                <ChevronDown size={13} className={`text-[#71717A] transition-transform ${showMembers ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {showMembers && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }} className="overflow-hidden"
                  >
                    {team.members.length === 0 ? (
                      <p className="text-sm text-[#71717A] px-3 py-2">No members yet</p>
                    ) : (
                      <div className="max-h-[480px] overflow-y-auto space-y-px mt-px">
                        {team.members.map(member => {
                          const isTeamCoordinator = team.coordinators.some(c => c.id === member.user_id)
                          const canRemove = isAdmin && !expired && member.user?.role !== 'principal' && member.user?.role !== 'admin'
                          return (
                            <div key={member.id} className="flex items-center justify-between py-2.5 px-3 bg-white border border-[#E4E4E7] hover:bg-[#EBEBEB] transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={30} userId={member.user?.id} />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-[#18181B] truncate">{member.user?.full_name || 'Unknown'}</p>
                                  <p className="text-xs text-[#71717A] truncate">{member.user?.email}</p>
                                </div>
                                {isTeamCoordinator ? (
                                  <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border flex-shrink-0 bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1">
                                    <Crown size={9} className="inline" /> Coordinator
                                  </span>
                                ) : member.user?.role ? (
                                  <span className={`hidden sm:inline text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border flex-shrink-0 ${ROLE_BADGE[member.user.role] ?? ROLE_BADGE.student}`}>
                                    {member.user.role}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
                                {isAdmin && !expired && (
                                  <button
                                    onClick={() => isTeamCoordinator ? onRemoveCoordinator(member.user_id) : onSetCoordinator(member.user_id)}
                                    className={`p-1.5 transition-colors ${isTeamCoordinator ? 'text-amber-600 bg-amber-50 hover:text-rose-600 hover:bg-rose-50' : 'text-[#71717A] hover:text-amber-600 hover:bg-amber-50'}`}
                                    title={isTeamCoordinator ? 'Remove as team coordinator' : 'Set as team coordinator'}
                                  >
                                    <Crown size={13} />
                                  </button>
                                )}
                                {canRemove && (
                                  <button
                                    onClick={() => onRemoveMember(member.user_id)}
                                    className="p-1.5 text-[#71717A] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                    title="Remove member"
                                  >
                                    <UserMinus size={13} />
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
