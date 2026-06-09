'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import UserEmailSuggest from '@/components/UserEmailSuggest'
import { useAuth } from '@/contexts/AuthContext'
import PageBanner from '@/components/PageBanner'
import { useRouter } from 'next/navigation'
import {
  Users, Plus, X, UserMinus, ChevronDown, ChevronUp,
  Calendar, Edit3, Trash2, Save, Loader2, Search,
} from 'lucide-react'
import { TEAMS_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  TeamWithDetails, fetchAllTeams, createTeam, updateTeam, deleteTeam,
  addTeamMemberByEmail, removeTeamMember,
} from '@/lib/teams'

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.025 } },
}
const itemVariants = { hidden: { opacity: 0 }, show: { opacity: 1 } }

const ai = 'border border-[#C9C3BB] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors w-full'
const aiSm = 'border border-[#C9C3BB] bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors'

const ROLE_BADGE: Record<string, string> = {
  admin:       'bg-rose-50 text-rose-700 border-rose-200',
  principal:   'bg-violet-50 text-violet-700 border-violet-200',
  coordinator: 'bg-blue-50 text-blue-700 border-blue-200',
  teacher:     'bg-teal-50 text-teal-700 border-teal-200',
  student:     'bg-[#A8896B]/10 text-[#8B7257] border-[#A8896B]/40',
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
  const [showMembersTeams, setShowMembersTeams] = useState<Set<string>>(new Set())

  const [newTeam, setNewTeam] = useState({ name: '', description: '', start_date: '', end_date: '', coordinator_email: '' })
  const [creating, setCreating] = useState(false)

  const [addMemberEmail, setAddMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [memberError, setMemberError] = useState('')

  const [editForm, setEditForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)

  const [teamSearch, setTeamSearch] = useState('')

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
    setEditForm({ name: team.name, description: team.description || '' })
  }

  const handleSaveEdit = async (teamId: string) => {
    setSaving(true)
    await updateTeam(teamId, { name: editForm.name.trim(), description: editForm.description.trim() || null })
    setEditingTeam(null)
    await loadTeams()
    setSaving(false)
  }

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm('Are you sure you want to delete this team?')) return
    await deleteTeam(teamId)
    await loadTeams()
  }

  if (!user || !profile) return null

  const searchLower = teamSearch.trim().toLowerCase()
  const filteredTeams = searchLower ? teams.filter(t => t.name.toLowerCase().includes(searchLower)) : teams

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin">
        <PageBanner
          settingKey="teams_banner"
          defaultBanner={TEAMS_BANNER_DEFAULT}
          icon={<Users size={26} className="text-white" />}
          title="Teacher Teams"
          subtitle="Manage teacher teams and coordinators"
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
                {showCreateForm ? 'Cancel' : 'Create Team'}
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

          {/* Create form */}
          <AnimatePresence>
            {showCreateForm && (
              <motion.div
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="mb-3 border border-[#C9C3BB] border-l-4 border-l-[#A8896B] bg-[#F3F0EB] overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#C9C3BB] bg-[#3D3B40]">
                  <span className="text-sm font-bold text-[#F3F0EB]">New Teacher Team</span>
                  <button type="button" onClick={() => setShowCreateForm(false)} className="text-[#F3F0EB]/60 hover:text-[#F3F0EB] transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleCreateTeam} className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">Team Name *</label>
                      <input type="text" value={newTeam.name} onChange={e => setNewTeam({ ...newTeam, name: e.target.value })} className={ai} placeholder="e.g., Science Department" required />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">Coordinator Email</label>
                      <UserEmailSuggest
                        value={newTeam.coordinator_email} onChange={v => setNewTeam({ ...newTeam, coordinator_email: v })}
                        roles={['coordinator', 'principal', 'admin']} placeholder="coordinator@school.com" className={ai}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">Description</label>
                    <textarea value={newTeam.description} onChange={e => setNewTeam({ ...newTeam, description: e.target.value })} className={`${ai} resize-none`} rows={2} placeholder="Brief description…" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">Start Date</label>
                      <input type="date" value={newTeam.start_date} onChange={e => setNewTeam({ ...newTeam, start_date: e.target.value })} className={ai} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">End Date</label>
                      <input type="date" value={newTeam.end_date} onChange={e => setNewTeam({ ...newTeam, end_date: e.target.value })} className={ai} />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="submit" disabled={creating} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] text-sm font-medium transition-colors disabled:opacity-50">
                      {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                      Create Team
                    </button>
                    <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2.5 border border-[#C9C3BB] text-[#2B292E] text-sm hover:bg-[#EAE6E0] transition-colors">Cancel</button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search bar */}
          {!loading && teams.length > 0 && (
            <div className="mb-3 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A7572] pointer-events-none" />
              <input
                type="text" value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                className="w-full border border-[#C9C3BB] bg-white pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors placeholder:text-[#9A9290]"
                placeholder="Search teams by name…"
              />
              {teamSearch && <button onClick={() => setTeamSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7A7572] hover:text-[#3D3B40]"><X size={13} /></button>}
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="border border-[#C9C3BB] bg-[#F3F0EB] py-16 text-center">
              <Loader2 size={20} className="animate-spin mx-auto mb-2 text-[#A8896B]" />
              <p className="text-sm text-[#7A7572]">Loading teams…</p>
            </div>
          ) : teams.length === 0 ? (
            <div className="border border-[#C9C3BB] bg-[#F3F0EB] p-12 text-center">
              <Users size={36} className="text-[#C9C3BB] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#2B292E] mb-1">No Teams Yet</p>
              <p className="text-sm text-[#7A7572] mb-5">Create your first teacher team to get started.</p>
              {isAdmin && (
                <button onClick={() => setShowCreateForm(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] text-sm font-medium transition-colors mx-auto">
                  <Plus size={14} /> Create Team
                </button>
              )}
            </div>
          ) : filteredTeams.length === 0 ? (
            <div className="border border-[#C9C3BB] bg-[#F3F0EB] p-10 text-center">
              <p className="text-sm text-[#7A7572]">No teams match &ldquo;{teamSearch}&rdquo;</p>
            </div>
          ) : (
            <div className="border border-[#C9C3BB] overflow-hidden">
              {/* Column headers */}
              <div className="bg-[#3D3B40] px-4 py-2.5 hidden sm:flex items-center gap-3">
                <span className="w-8 flex-shrink-0" />
                <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A8896B]">Name</span>
                <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A8896B] flex-shrink-0">Coordinator</span>
                <span className="w-20 text-[10px] font-bold uppercase tracking-widest text-[#A8896B] flex-shrink-0">Members</span>
                <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A8896B] flex-shrink-0">Dates</span>
                <span className="w-20 text-[10px] font-bold uppercase tracking-widest text-[#A8896B] text-right flex-shrink-0">Actions</span>
              </div>

              <motion.div variants={containerVariants} initial="hidden" animate="show">
                {filteredTeams.map(team => (
                  <motion.div key={team.id} variants={itemVariants}>
                    {/* Row */}
                    <div
                      className="flex items-stretch border-b border-[#E0DCD6] last:border-b-0 hover:bg-[#EAE6E0] transition-colors cursor-pointer"
                      onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
                    >
                      <div className="w-1 flex-shrink-0 bg-[#A8896B]" />
                      <div className="flex items-center gap-3 flex-1 px-4 py-3 min-w-0">

                        {/* Initials avatar */}
                        <div className="w-8 h-8 flex-shrink-0 bg-[#3D3B40] flex items-center justify-center text-[#A8896B] text-sm font-bold">
                          {team.name.charAt(0).toUpperCase()}
                        </div>

                        {/* Name */}
                        <div className="flex-1 min-w-0" onClick={e => editingTeam === team.id ? e.stopPropagation() : undefined}>
                          {editingTeam === team.id ? (
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <input
                                type="text" value={editForm.name}
                                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                className={`${aiSm} w-40`}
                              />
                              <button onClick={() => handleSaveEdit(team.id)} disabled={saving} className="p-1.5 text-[#A8896B] hover:bg-[#E0DCD6] transition-colors disabled:opacity-50">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              </button>
                              <button onClick={() => setEditingTeam(null)} className="p-1.5 text-[#7A7572] hover:bg-[#E0DCD6] transition-colors"><X size={14} /></button>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm font-semibold text-[#2B292E] truncate">{team.name}</p>
                              {team.description && <p className="hidden sm:block text-xs text-[#7A7572] truncate">{team.description}</p>}
                            </>
                          )}
                        </div>

                        {/* Coordinator — desktop */}
                        <div className="hidden sm:block w-32 flex-shrink-0 min-w-0">
                          {team.coordinator ? (
                            <span className="text-xs text-[#7A7572] truncate block">{team.coordinator.full_name}</span>
                          ) : null}
                        </div>

                        {/* Member count — desktop */}
                        <span className="hidden sm:block text-xs text-[#7A7572] w-20 flex-shrink-0">
                          {team.member_count} member{team.member_count !== 1 ? 's' : ''}
                        </span>

                        {/* Dates — desktop */}
                        <div className="hidden sm:flex items-center gap-1 w-24 flex-shrink-0 min-w-0">
                          {team.start_date ? (
                            <span className="text-[11px] text-[#7A7572] truncate">
                              {new Date(team.start_date).getFullYear()}
                              {team.end_date ? `–${new Date(team.end_date).getFullYear()}` : ''}
                            </span>
                          ) : null}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 w-20 justify-end flex-shrink-0">
                          {isAdmin && (
                            <>
                              <button onClick={e => { e.stopPropagation(); handleStartEdit(team) }} className="p-1.5 text-[#7A7572] hover:text-[#3D3B40] hover:bg-[#E0DCD6] transition-colors">
                                <Edit3 size={14} />
                              </button>
                              <button onClick={e => { e.stopPropagation(); handleDeleteTeam(team.id) }} className="p-1.5 text-[#7A7572] hover:text-rose-600 hover:bg-rose-50 transition-colors">
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                          <div className="p-1.5 text-[#7A7572]">
                            {expandedTeam === team.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expanded content */}
                    <AnimatePresence>
                      {expandedTeam === team.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }} className="overflow-hidden"
                        >
                          <div className="border-b border-[#E0DCD6] bg-[#F3F0EB] px-5 py-4 space-y-3">
                            {/* Add member */}
                            {isAdmin && (
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <UserEmailSuggest
                                    value={addMemberEmail} onChange={v => { setAddMemberEmail(v); setMemberError('') }}
                                    roles={['teacher', 'coordinator', 'principal', 'admin']}
                                    placeholder="Add member by email…"
                                    className="border border-[#C9C3BB] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors w-full"
                                  />
                                </div>
                                <button
                                  onClick={() => handleAddMember(team.id)} disabled={addingMember === team.id}
                                  className="px-4 py-2 bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
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
                              onClick={() => setShowMembersTeams(prev => {
                                const next = new Set(prev)
                                next.has(team.id) ? next.delete(team.id) : next.add(team.id)
                                return next
                              })}
                              className="w-full flex items-center justify-between py-2 px-3 bg-white border border-[#C9C3BB] hover:bg-[#EAE6E0] transition-colors"
                            >
                              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#A8896B]">
                                <Users size={12} /> Members
                                <span className="font-normal text-[#7A7572] normal-case">({team.members.length})</span>
                              </span>
                              <ChevronDown size={13} className={`text-[#7A7572] transition-transform ${showMembersTeams.has(team.id) ? 'rotate-180' : ''}`} />
                            </button>

                            <AnimatePresence>
                              {showMembersTeams.has(team.id) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.15 }} className="overflow-hidden"
                                >
                                  {team.members.length === 0 ? (
                                    <p className="text-sm text-[#7A7572] px-3 py-2">No members yet</p>
                                  ) : (
                                    <div className="max-h-[480px] overflow-y-auto space-y-px mt-px">
                                      {team.members.map(member => (
                                        <div key={member.id} className="flex items-center justify-between py-2.5 px-3 bg-white border border-[#E0DCD6] hover:bg-[#EAE6E0] transition-colors">
                                          <div className="flex items-center gap-3 min-w-0">
                                            <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={30} userId={member.user?.id} />
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium text-[#2B292E] truncate">{member.user?.full_name || 'Unknown'}</p>
                                              <p className="text-xs text-[#7A7572] truncate">{member.user?.email}</p>
                                            </div>
                                            {member.user?.role && (
                                              <span className={`hidden sm:inline text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border flex-shrink-0 ${ROLE_BADGE[member.user.role] ?? ROLE_BADGE.student}`}>
                                                {member.user.role}
                                              </span>
                                            )}
                                          </div>
                                          {isAdmin && member.user?.role !== 'principal' && member.user?.role !== 'admin' && (
                                            <button
                                              onClick={() => handleRemoveMember(team.id, member.user_id)}
                                              className="flex-shrink-0 p-1.5 text-[#7A7572] hover:text-rose-600 hover:bg-rose-50 transition-colors ml-2"
                                              title="Remove member"
                                            >
                                              <UserMinus size={13} />
                                            </button>
                                          )}
                                        </div>
                                      ))}
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
                ))}
              </motion.div>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
