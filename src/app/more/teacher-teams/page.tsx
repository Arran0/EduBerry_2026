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
  Users,
  Plus,
  X,
  UserMinus,
  ChevronDown,
  ChevronUp,
  Calendar,
  Edit3,
  Trash2,
  Save,
  Loader2,
  Search,
} from 'lucide-react'
import { TEAMS_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  TeamWithDetails,
  fetchAllTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMemberByEmail,
  removeTeamMember,
} from '@/lib/teams'

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
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

  // Create form state
  const [newTeam, setNewTeam] = useState({
    name: '',
    description: '',
    start_date: '',
    end_date: '',
    coordinator_email: '',
  })
  const [creating, setCreating] = useState(false)

  // Add member state
  const [addMemberEmail, setAddMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [memberError, setMemberError] = useState('')

  // Edit state
  const [editForm, setEditForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)

  // Search
  const [teamSearch, setTeamSearch] = useState('')

  const loadTeams = useCallback(async () => {
    setLoading(true)
    const data = await fetchAllTeams()
    setTeams(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadTeams()
  }, [loadTeams])

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
    setAddingMember(teamId)
    setMemberError('')

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
    await updateTeam(teamId, {
      name: editForm.name.trim(),
      description: editForm.description.trim() || null,
    })
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
  const filteredTeams = searchLower
    ? teams.filter(t => t.name.toLowerCase().includes(searchLower))
    : teams

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="more">

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
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-medium text-sm rounded-xl border border-white/30 transition-colors"
              >
                {showCreateForm ? <X size={15} /> : <Plus size={15} />}
                {showCreateForm ? 'Cancel' : 'Create Team'}
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

        {/* ── Content ── */}
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

          {/* Create Team Form */}
          <AnimatePresence>
            {showCreateForm && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
              >
                {/* Form header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-pink-50 to-purple-50">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-pink-100 rounded-lg">
                      <Users size={15} className="text-pink-600" />
                    </div>
                    <h3 className="font-semibold text-slate-800 text-sm">New Teacher Team</h3>
                  </div>
                  <button type="button" onClick={() => setShowCreateForm(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white/80 rounded-lg transition-colors">
                    <X size={15} />
                  </button>
                </div>

                <form onSubmit={handleCreateTeam} className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Team Name *</label>
                      <input
                        type="text"
                        value={newTeam.name}
                        onChange={e => setNewTeam({ ...newTeam, name: e.target.value })}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 bg-slate-50 focus:bg-white transition-colors"
                        placeholder="e.g., Science Department"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Coordinator Email</label>
                      <UserEmailSuggest
                        value={newTeam.coordinator_email}
                        onChange={v => setNewTeam({ ...newTeam, coordinator_email: v })}
                        roles={['coordinator', 'principal', 'admin']}
                        placeholder="coordinator@school.com"
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 bg-slate-50 focus:bg-white transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Description</label>
                    <textarea
                      value={newTeam.description}
                      onChange={e => setNewTeam({ ...newTeam, description: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 bg-slate-50 focus:bg-white transition-colors resize-none"
                      rows={2}
                      placeholder="Brief description of the team..."
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Start Date</label>
                      <input
                        type="date"
                        value={newTeam.start_date}
                        onChange={e => setNewTeam({ ...newTeam, start_date: e.target.value })}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 bg-slate-50 focus:bg-white transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">End Date</label>
                      <input
                        type="date"
                        value={newTeam.end_date}
                        onChange={e => setNewTeam({ ...newTeam, end_date: e.target.value })}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 bg-slate-50 focus:bg-white transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button type="submit" disabled={creating} className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
                      {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      Create Team
                    </button>
                    <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search Bar */}
          {!loading && teams.length > 0 && (
            <div className="mb-4 relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={teamSearch}
                onChange={e => setTeamSearch(e.target.value)}
                className="w-full border border-slate-200 rounded-xl pl-10 pr-9 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-300 shadow-sm transition-colors"
                placeholder="Search teams by name…"
              />
              {teamSearch && (
                <button
                  onClick={() => setTeamSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {/* Teams List */}
          {loading ? (
            <div className="text-center py-16">
              <div className="spinner mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading teams…</p>
            </div>
          ) : teams.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
              <Users size={44} className="text-slate-200 mx-auto mb-4" />
              <h3 className="font-display text-xl font-bold text-slate-700 mb-2">No Teams Yet</h3>
              <p className="text-slate-500 text-sm mb-6">Create your first teacher team to get started.</p>
              {isAdmin && (
                <button onClick={() => setShowCreateForm(true)} className="btn-primary">
                  <Plus size={16} className="inline mr-1" /> Create Team
                </button>
              )}
            </div>
          ) : filteredTeams.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
              <Search size={36} className="text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No teams match &ldquo;{teamSearch}&rdquo;</p>
            </div>
          ) : (
            <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-3">
              {filteredTeams.map(team => (
                <motion.div
                  key={team.id}
                  variants={itemVariants}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* Team Header */}
                  <div
                    className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/60 transition-colors"
                    onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        {/* Team avatar */}
                        <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-bold text-lg shadow-md">
                          {team.name.charAt(0).toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          {editingTeam === team.id ? (
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <input
                                type="text"
                                value={editForm.name}
                                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                className="border border-slate-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400"
                              />
                              <button onClick={() => handleSaveEdit(team.id)} disabled={saving} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                                <Save size={15} />
                              </button>
                              <button onClick={() => setEditingTeam(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors">
                                <X size={15} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <h3 className="font-semibold text-slate-800 text-base truncate">{team.name}</h3>
                              {team.description && (
                                <p className="hidden sm:block text-xs text-slate-500 mt-0.5 truncate">{team.description}</p>
                              )}
                            </>
                          )}

                          {/* Meta row */}
                          <div className="flex items-center flex-wrap gap-2 mt-1">
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Users size={11} className="text-slate-400" />
                              {team.member_count} member{team.member_count !== 1 ? 's' : ''}
                            </span>
                            {team.coordinator && (
                              <span className="hidden sm:inline text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                                {team.coordinator.full_name}
                              </span>
                            )}
                            {team.start_date && (
                              <span className="hidden sm:flex text-xs text-slate-400 items-center gap-1">
                                <Calendar size={11} />
                                {new Date(team.start_date).toLocaleDateString()}
                                {team.end_date && ` – ${new Date(team.end_date).toLocaleDateString()}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {isAdmin && (
                          <>
                            <button
                              onClick={e => { e.stopPropagation(); handleStartEdit(team) }}
                              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              <Edit3 size={15} />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteTeam(team.id) }}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                        {expandedTeam === team.id
                          ? <ChevronUp size={17} className="text-slate-400" />
                          : <ChevronDown size={17} className="text-slate-400" />
                        }
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  <AnimatePresence>
                    {expandedTeam === team.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-slate-100 p-4 sm:p-5 space-y-4">
                          {/* Add Member */}
                          {isAdmin && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <UserEmailSuggest
                                  value={addMemberEmail}
                                  onChange={v => { setAddMemberEmail(v); setMemberError('') }}
                                  roles={['teacher', 'coordinator', 'principal', 'admin']}
                                  placeholder="Add member by email…"
                                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 bg-slate-50 focus:bg-white transition-colors"
                                />
                              </div>
                              <button
                                onClick={() => handleAddMember(team.id)}
                                disabled={addingMember === team.id}
                                className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {addingMember === team.id
                                  ? <Loader2 size={14} className="animate-spin" />
                                  : <Plus size={14} />
                                }
                                Add
                              </button>
                            </div>
                          )}
                          {memberError && (
                            <p className="text-xs text-rose-500">{memberError}</p>
                          )}

                          {/* Members toggle */}
                          <button
                            type="button"
                            onClick={() => setShowMembersTeams(prev => {
                              const next = new Set(prev)
                              next.has(team.id) ? next.delete(team.id) : next.add(team.id)
                              return next
                            })}
                            className="w-full flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
                          >
                            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                              <Users size={14} className="text-slate-400" />
                              Members
                              <span className="text-xs font-normal text-slate-400">({team.members.length})</span>
                            </span>
                            <ChevronDown size={14} className={`text-slate-400 transition-transform ${showMembersTeams.has(team.id) ? 'rotate-180' : ''}`} />
                          </button>

                          {/* Scrollable member list */}
                          <AnimatePresence>
                            {showMembersTeams.has(team.id) && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                {team.members.length === 0 ? (
                                  <p className="text-sm text-slate-400 italic px-3">No members yet</p>
                                ) : (
                                  <div className="max-h-[520px] overflow-y-auto space-y-1.5 pr-0.5">
                                    {team.members.map(member => (
                                      <div key={member.id} className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-100/70 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                          <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={32} userId={member.user?.id} />
                                          <div className="min-w-0">
                                            <p className="text-sm font-medium text-slate-700 truncate">{member.user?.full_name || 'Unknown'}</p>
                                            <p className="text-xs text-slate-400 truncate">{member.user?.email}</p>
                                          </div>
                                          {member.user?.role && (
                                            <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 capitalize flex-shrink-0">
                                              {member.user.role}
                                            </span>
                                          )}
                                        </div>
                                        {isAdmin && member.user?.role !== 'principal' && member.user?.role !== 'admin' && (
                                          <button
                                            onClick={() => handleRemoveMember(team.id, member.user_id)}
                                            className="flex-shrink-0 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors ml-2"
                                            title="Remove member"
                                          >
                                            <UserMinus size={14} />
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
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
