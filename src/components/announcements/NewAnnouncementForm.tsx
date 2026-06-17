'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  FileText,
  GraduationCap,
  Users,
  Check,
  AlertCircle,
  Megaphone,
  ImageIcon,
  Youtube,
  Paperclip,
  Search,
  UserPlus,
  Link2,
  School,
} from 'lucide-react'
import {
  createAnnouncement,
  uploadAnnouncementFile,
  AnnouncementAttachment,
} from '@/lib/announcements'
import { searchHomerooms, Homeroom } from '@/lib/homerooms'
import { supabase, UserRole, UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'

interface NewAnnouncementFormProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  currentUserId: string
  currentUserRole: UserRole
  /** Teams the current coordinator belongs to (for coordinator audience) */
  userTeams?: { id: string; name: string }[]
  /** All teams in the school (for principal / admin audience) */
  allTeams?: { id: string; name: string }[]
  /** Maps team IDs to their grade range (used to limit coordinator's grade picker) */
  teamGradeRanges?: { teamId: string; grades: number[] }[]
}

const ALL_GRADES = Array.from({ length: 12 }, (_, i) => i + 1)

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function Checkbox({ checked, className = '' }: { checked: boolean; className?: string }) {
  return (
    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
      checked ? 'bg-mps-blue-500 border-mps-blue-500' : 'border-slate-300'
    } ${className}`}>
      {checked && <Check size={12} className="text-white" />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewAnnouncementForm({
  isOpen,
  onClose,
  onCreated,
  currentUserId,
  currentUserRole,
  userTeams = [],
  allTeams  = [],
  teamGradeRanges = [],
}: NewAnnouncementFormProps) {
  // ── Permissions ──────────────────────────────────────────────────────────
  const isCoordinator      = currentUserRole === 'coordinator'
  const isPrincipalOrAdmin = currentUserRole === 'principal' || currentUserRole === 'admin'
  // All three roles (coordinator, principal, admin) can target both students and staff
  // but coordinator is limited to their own grade ranges and teams
  const useInclusivePicker = isCoordinator || isPrincipalOrAdmin

  // ── Form state ───────────────────────────────────────────────────────────
  const [title,   setTitle]   = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Attachments
  const [attachments, setAttachments]     = useState<AnnouncementAttachment[]>([])
  const [youtubeUrl, setYoutubeUrl]       = useState('')
  const [linkUrl,    setLinkUrl]          = useState('')
  const [linkLabel,  setLinkLabel]        = useState('')
  const [uploading, setUploading]         = useState(false)
  const [showYoutubeInput, setShowYoutubeInput] = useState(false)
  const [showLinkInput,    setShowLinkInput]    = useState(false)

  // ── Audience type (coordinator: exclusive toggle; principal/admin: multi-select) ──
  // 'student' | 'staff' | 'both'  — for coordinator only 'student' or 'staff'
  const [audienceMode, setAudienceMode] = useState<'student' | 'staff'>('student')

  // Student audience state
  const [allStudents, setAllStudents]       = useState(false)
  const [selectedGrades, setSelectedGrades] = useState<number[]>([])
  // Specific homerooms added via the search bar (grade + section pairs)
  const [selectedHomerooms, setSelectedHomerooms] = useState<Homeroom[]>([])
  const [homeroomQuery,       setHomeroomQuery]       = useState('')
  const [homeroomSuggestions, setHomeroomSuggestions] = useState<Homeroom[]>([])
  const homeroomInputRef = useRef<HTMLInputElement>(null)

  // Staff audience state
  const [allStaff, setAllStaff]                 = useState(false)
  const [selectedTeamIds, setSelectedTeamIds]   = useState<string[]>([])

  // For principal/admin: can include BOTH student and staff in one announcement
  const [includeStudents, setIncludeStudents] = useState(true)
  const [includeStaff, setIncludeStaff]       = useState(false)

  // Individual member targeting
  const [showMemberSearch,   setShowMemberSearch]   = useState(false)
  const [memberQuery,        setMemberQuery]        = useState('')
  const [memberSuggestions,  setMemberSuggestions]  = useState<UserProfile[]>([])
  const [individualMembers,  setIndividualMembers]  = useState<UserProfile[]>([])
  const memberInputRef = useRef<HTMLInputElement>(null)

  // ── Derived values ───────────────────────────────────────────────────────

  /** Grades available in the grade picker (coordinator is limited to their teams) */
  const availableGrades = useMemo(() => {
    if (isPrincipalOrAdmin) return ALL_GRADES
    if (teamGradeRanges.length === 0) return ALL_GRADES

    const userTeamIds = new Set(userTeams.map(t => t.id))
    const grades = new Set<number>()
    for (const range of teamGradeRanges) {
      if (userTeamIds.has(range.teamId)) {
        range.grades.forEach(g => grades.add(g))
      }
    }
    const result = Array.from(grades).sort((a, b) => a - b)
    return result.length > 0 ? result : ALL_GRADES
  }, [isPrincipalOrAdmin, teamGradeRanges, userTeams])

  /** Teams shown in the team picker */
  const availableTeams = isPrincipalOrAdmin ? allTeams : userTeams

  // ── Individual member search ──────────────────────────────────────────────
  useEffect(() => {
    const query = memberQuery.trim()
    if (query.length < 2) { setMemberSuggestions([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, avatar_url, grade, section, created_at, updated_at')
        .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
        .order('full_name')
        .limit(6)
      const results = (data || []) as UserProfile[]
      // Exclude already-selected members
      const selectedIds = new Set(individualMembers.map(m => m.id))
      setMemberSuggestions(results.filter(r => !selectedIds.has(r.id)))
    }, 200)
    return () => clearTimeout(timer)
  }, [memberQuery, individualMembers])

  const addIndividualMember = (user: UserProfile) => {
    setIndividualMembers(prev => prev.find(m => m.id === user.id) ? prev : [...prev, user])
    setMemberQuery('')
    setMemberSuggestions([])
    memberInputRef.current?.focus()
  }

  const removeIndividualMember = (userId: string) => {
    setIndividualMembers(prev => prev.filter(m => m.id !== userId))
  }

  // ── Homeroom search ───────────────────────────────────────────────────────
  useEffect(() => {
    const q = homeroomQuery.trim()
    if (q.length < 1) { setHomeroomSuggestions([]); return }
    const timer = setTimeout(async () => {
      const results = await searchHomerooms(q)
      const selectedIds = new Set(selectedHomerooms.map(hr => hr.id))
      // For coordinators, limit to their available grades
      const filtered = results.filter(hr =>
        !selectedIds.has(hr.id) &&
        (hr.grade == null || availableGrades.includes(hr.grade))
      )
      setHomeroomSuggestions(filtered)
    }, 200)
    return () => clearTimeout(timer)
  }, [homeroomQuery, selectedHomerooms, availableGrades])

  const addHomeroom = (hr: Homeroom) => {
    setSelectedHomerooms(prev => prev.find(h => h.id === hr.id) ? prev : [...prev, hr])
    setHomeroomQuery('')
    setHomeroomSuggestions([])
    homeroomInputRef.current?.focus()
  }

  const removeHomeroom = (id: string) => {
    setSelectedHomerooms(prev => prev.filter(hr => hr.id !== id))
  }

  // ── Attachment helpers ────────────────────────────────────────────────────
  const handleFileAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const result = await uploadAnnouncementFile(file)
      if (result) {
        const isImage = file.type.startsWith('image/')
        setAttachments(prev => [...prev, { type: isImage ? 'image' : 'document', url: result.url, name: result.name }])
      }
    }
    setUploading(false)
  }

  const handleAddYoutube = () => {
    const url = youtubeUrl.trim()
    if (!url) return
    setAttachments(prev => [...prev, { type: 'youtube', url, name: 'YouTube Video' }])
    setYoutubeUrl('')
    setShowYoutubeInput(false)
  }

  const handleAddLink = () => {
    const url = linkUrl.trim()
    if (!url) return
    setAttachments(prev => [...prev, { type: 'link', url, name: linkLabel.trim() || url }])
    setLinkUrl('')
    setLinkLabel('')
    setShowLinkInput(false)
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // ── Form reset ───────────────────────────────────────────────────────────
  const resetForm = () => {
    setTitle('')
    setContent('')
    setError(null)
    setAttachments([])
    setYoutubeUrl('')
    setLinkUrl('')
    setLinkLabel('')
    setShowYoutubeInput(false)
    setShowLinkInput(false)
    setAudienceMode('student')
    setAllStudents(false)
    setSelectedGrades([])
    setSelectedHomerooms([])
    setHomeroomQuery('')
    setHomeroomSuggestions([])
    setAllStaff(false)
    setSelectedTeamIds([])
    setIncludeStudents(true)
    setIncludeStaff(false)
    setIndividualMembers([])
    setMemberQuery('')
    setShowMemberSearch(false)
  }

  // ── Grade / section toggles ──────────────────────────────────────────────
  const toggleGrade = (grade: number) => {
    setSelectedGrades(prev => {
      if (prev.includes(grade)) {
        // When deselecting a full grade, also remove any homerooms for that grade
        setSelectedHomerooms(h => h.filter(hr => hr.grade !== grade))
        return prev.filter(g => g !== grade)
      }
      return [...prev, grade].sort((a, b) => a - b)
    })
  }

  const toggleAllStudents = () => {
    if (!allStudents) {
      setAllStudents(true)
      setSelectedGrades([])
      setSelectedSections({})
    } else {
      setAllStudents(false)
    }
  }

  // ── Team toggles ─────────────────────────────────────────────────────────
  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds(prev =>
      prev.includes(teamId) ? prev.filter(id => id !== teamId) : [...prev, teamId]
    )
  }

  const toggleAllStaff = () => {
    if (!allStaff) {
      setAllStaff(true)
      setSelectedTeamIds([])
    } else {
      setAllStaff(false)
    }
  }

  // ── Audience mode switch (coordinator only) ───────────────────────────────
  const switchAudienceMode = (mode: 'student' | 'staff') => {
    setAudienceMode(mode)
    if (mode === 'student') { setAllStaff(false); setSelectedTeamIds([]) }
    else { setAllStudents(false); setSelectedGrades([]); setSelectedHomerooms([]) }
  }

  // ── Build audience rows ──────────────────────────────────────────────────
  const buildStudentAudiences = () => {
    if (allStudents) return [{ all_students: true }]
    const rows: { grade?: number; section?: string; all_students?: boolean }[] = []
    // Full grades (covers all sections of that grade)
    for (const grade of selectedGrades) rows.push({ grade })
    // Individual homerooms (specific grade+section not covered by a full-grade selection)
    for (const hr of selectedHomerooms) {
      if (hr.grade && hr.section && !selectedGrades.includes(hr.grade)) {
        rows.push({ grade: hr.grade, section: hr.section })
      }
    }
    return rows
  }

  const buildStaffAudiences = () => {
    if (allStaff) return [{ all_teams: true }]
    return selectedTeamIds.map(team_id => ({ team_id }))
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const studentAudienceValid = (): boolean =>
    allStudents || selectedGrades.length > 0 || selectedHomerooms.length > 0

  const staffAudienceValid = (): boolean => allStaff || selectedTeamIds.length > 0

  const canSubmit = (): boolean => {
    if (!title.trim() || !content.trim()) return false

    if (useInclusivePicker) {
      const hasIndividuals = individualMembers.length > 0
      if (!includeStudents && !includeStaff && !hasIndividuals) return false
      if (includeStudents && !studentAudienceValid()) return false
      if (includeStaff && !staffAudienceValid()) return false
      return true
    }

    // Fallback (shouldn't be reached but kept for safety)
    if (audienceMode === 'student') return studentAudienceValid()
    return staffAudienceValid()
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit()) return

    setSubmitting(true)
    setError(null)

    try {
      const audiences: Parameters<typeof createAnnouncement>[0]['audiences'] = []

      const wantStudents = useInclusivePicker ? includeStudents : audienceMode === 'student'
      const wantStaff    = useInclusivePicker ? includeStaff    : audienceMode === 'staff'

      if (wantStudents) audiences.push(...buildStudentAudiences())
      if (wantStaff)    audiences.push(...buildStaffAudiences())
      for (const member of individualMembers) audiences.push({ user_id: member.id })

      const result = await createAnnouncement(
        { title: title.trim(), content: content.trim(), attachments: attachments.length > 0 ? attachments : undefined, audiences },
        currentUserId
      )

      if (!result) {
        setError('Failed to create announcement. Please try again.')
        setSubmitting(false)
        return
      }

      resetForm()
      onCreated()
      onClose()
    } catch (err) {
      console.error('Unexpected error creating announcement:', err)
      setError('Failed to create announcement. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const StudentPicker = () => (
    <div className="border border-slate-200 rounded-xl p-3 space-y-3">
      {/* All Students — principal / admin only */}
      {isPrincipalOrAdmin && (
        <button
          type="button"
          onClick={toggleAllStudents}
          className={`w-full flex items-center gap-2 p-2.5 rounded-lg transition-colors text-left text-sm ${
            allStudents
              ? 'bg-mps-blue-50 text-mps-blue-700 border border-mps-blue-200'
              : 'hover:bg-slate-50 text-slate-700'
          }`}
        >
          <Checkbox checked={allStudents} />
          <GraduationCap size={14} />
          <span className="font-medium">All Students</span>
        </button>
      )}

      {!allStudents && (
        <>
          {/* Full-grade picker */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Grades (full grade)</p>
            <div className="flex flex-wrap gap-1.5">
              {availableGrades.map(grade => (
                <button
                  key={grade}
                  type="button"
                  onClick={() => toggleGrade(grade)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedGrades.includes(grade)
                      ? 'bg-mps-blue-500 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Grade {grade}
                </button>
              ))}
            </div>
          </div>

          {/* Homeroom adder */}
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-500 flex items-center gap-1">
              <School size={12} /> Specific homerooms
            </p>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={homeroomInputRef}
                type="text"
                value={homeroomQuery}
                onChange={e => setHomeroomQuery(e.target.value)}
                placeholder="Search homeroom — e.g. 9A, Grade 10..."
                className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500"
              />
              {homeroomSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-20">
                  {homeroomSuggestions.map(hr => (
                    <button
                      key={hr.id}
                      type="button"
                      onClick={() => addHomeroom(hr)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-lg bg-mps-blue-50 flex items-center justify-center flex-shrink-0">
                        <School size={13} className="text-mps-blue-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-700">{hr.name}</p>
                        {hr.grade && hr.section && (
                          <p className="text-[11px] text-slate-400">Grade {hr.grade} · Section {hr.section}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected homeroom chips */}
            {selectedHomerooms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {selectedHomerooms.map(hr => {
                  const coveredByGrade = hr.grade != null && selectedGrades.includes(hr.grade)
                  return (
                    <span
                      key={hr.id}
                      className={`inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-xs font-medium border ${
                        coveredByGrade
                          ? 'bg-slate-50 text-slate-400 border-slate-200 line-through'
                          : 'bg-mps-blue-50 text-mps-blue-700 border-mps-blue-200'
                      }`}
                      title={coveredByGrade ? 'Already covered by full-grade selection' : undefined}
                    >
                      <School size={10} />
                      {hr.name}
                      <button type="button" onClick={() => removeHomeroom(hr.id)} className="ml-0.5 hover:text-red-500 transition-colors">
                        <X size={10} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )

  const StaffPicker = () => (
    <div className="border border-slate-200 rounded-xl p-3 space-y-1.5">
      {/* All Staff — principal / admin only */}
      {isPrincipalOrAdmin && (
        <button
          type="button"
          onClick={toggleAllStaff}
          className={`w-full flex items-center gap-2 p-2.5 rounded-lg transition-colors text-left text-sm ${
            allStaff
              ? 'bg-purple-50 text-purple-700 border border-purple-200'
              : 'hover:bg-slate-50 text-slate-700'
          }`}
        >
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            allStaff ? 'bg-purple-500 border-purple-500' : 'border-slate-300'
          }`}>
            {allStaff && <Check size={12} className="text-white" />}
          </div>
          <Users size={14} />
          <span className="font-medium">All Staff</span>
        </button>
      )}

      {/* Team list */}
      {!allStaff && availableTeams.map(team => (
        <button
          key={team.id}
          type="button"
          onClick={() => toggleTeam(team.id)}
          className={`w-full flex items-center gap-2 p-2.5 rounded-lg transition-colors text-left text-sm ${
            selectedTeamIds.includes(team.id)
              ? 'bg-mps-blue-50 text-mps-blue-700 border border-mps-blue-200'
              : 'hover:bg-slate-50 text-slate-700'
          }`}
        >
          <Checkbox checked={selectedTeamIds.includes(team.id)} />
          <span>{team.name}</span>
        </button>
      ))}

      {availableTeams.length === 0 && !isPrincipalOrAdmin && (
        <p className="text-sm text-slate-400 text-center py-3">No teams available</p>
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 12 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.18 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white rounded-t-3xl border-b border-slate-100 p-5 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Megaphone size={20} className="text-mps-blue-600" />
                New Announcement
              </h2>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Title */}
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Announcement title"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500"
                  required
                  autoFocus
                />
              </div>

              {/* Content + inline attachment toolbar */}
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                  <FileText size={14} /> Content <span className="text-red-500">*</span>
                </label>
                <div className="border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-mps-blue-500/50 focus-within:border-mps-blue-500 transition-shadow">
                  <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="Write your announcement..."
                    rows={4}
                    className="w-full px-4 py-2.5 text-sm focus:outline-none resize-none"
                    required
                  />

                  {/* Attached items chips */}
                  {attachments.length > 0 && (
                    <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                      {attachments.map((att, i) => (
                        <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs text-slate-700">
                          {att.type === 'image'    && <ImageIcon size={11} className="text-green-500  flex-shrink-0" />}
                          {att.type === 'youtube'  && <Youtube   size={11} className="text-red-500    flex-shrink-0" />}
                          {att.type === 'document' && <FileText  size={11} className="text-blue-500   flex-shrink-0" />}
                          {att.type === 'link'     && <Link2     size={11} className="text-violet-500 flex-shrink-0" />}
                          <span className="max-w-[120px] truncate">{att.name}</span>
                          <button type="button" onClick={() => removeAttachment(i)} className="ml-0.5 text-slate-400 hover:text-red-500 transition-colors">
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline YouTube URL input */}
                  {showYoutubeInput && (
                    <div className="px-3 pb-2 flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
                        <Youtube size={13} className="text-red-500 flex-shrink-0" />
                        <input
                          type="url"
                          value={youtubeUrl}
                          onChange={e => setYoutubeUrl(e.target.value)}
                          placeholder="Paste YouTube URL"
                          className="flex-1 text-xs focus:outline-none"
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddYoutube())}
                          autoFocus
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleAddYoutube}
                        disabled={!youtubeUrl.trim()}
                        className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors border border-red-200 disabled:opacity-40"
                      >Add</button>
                      <button type="button" onClick={() => { setShowYoutubeInput(false); setYoutubeUrl('') }} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {/* Inline Link input */}
                  {showLinkInput && (
                    <div className="px-3 pb-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
                          <Link2 size={13} className="text-violet-500 flex-shrink-0" />
                          <input
                            type="url"
                            value={linkUrl}
                            onChange={e => setLinkUrl(e.target.value)}
                            placeholder="Paste link URL"
                            className="flex-1 text-xs focus:outline-none"
                            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddLink())}
                            autoFocus
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleAddLink}
                          disabled={!linkUrl.trim()}
                          className="px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-600 text-xs font-medium hover:bg-violet-100 transition-colors border border-violet-200 disabled:opacity-40"
                        >Add</button>
                        <button type="button" onClick={() => { setShowLinkInput(false); setLinkUrl(''); setLinkLabel('') }} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                      {linkUrl.trim() && (
                        <input
                          type="text"
                          value={linkLabel}
                          onChange={e => setLinkLabel(e.target.value)}
                          placeholder="Link label (optional)"
                          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400/40 focus:border-violet-400"
                        />
                      )}
                    </div>
                  )}

                  {/* Attachment toolbar */}
                  <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-0.5">
                    {uploading && <span className="text-xs text-slate-400 mr-auto">Uploading…</span>}
                    <label className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-500 cursor-pointer hover:bg-green-50 hover:text-green-700 transition-colors" title="Upload image">
                      <ImageIcon size={15} />
                      <input type="file" accept="image/*" className="hidden" multiple onChange={e => handleFileAttach(e.target.files)} />
                    </label>
                    <label className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-500 cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors" title="Upload document">
                      <Paperclip size={15} />
                      <input type="file" className="hidden" multiple onChange={e => handleFileAttach(e.target.files)} />
                    </label>
                    <button
                      type="button"
                      onClick={() => { setShowYoutubeInput(p => !p); setShowLinkInput(false) }}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors ${showYoutubeInput ? 'bg-red-50 text-red-600' : 'text-slate-500 hover:bg-red-50 hover:text-red-600'}`}
                      title="Add YouTube video"
                    >
                      <Youtube size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowLinkInput(p => !p); setShowYoutubeInput(false) }}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors ${showLinkInput ? 'bg-violet-50 text-violet-600' : 'text-slate-500 hover:bg-violet-50 hover:text-violet-600'}`}
                      title="Add link"
                    >
                      <Link2 size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Audience ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">Audience</label>
                  <button
                    type="button"
                    onClick={() => { setShowMemberSearch(p => !p); setMemberQuery(''); setMemberSuggestions([]) }}
                    className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                      showMemberSearch
                        ? 'bg-violet-100 text-violet-700'
                        : 'text-slate-500 hover:text-violet-600 hover:bg-violet-50'
                    }`}
                    title="Add individual member"
                  >
                    <UserPlus size={13} />
                    Add member
                  </button>
                </div>

                {/* Individual member search */}
                {showMemberSearch && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        ref={memberInputRef}
                        type="text"
                        value={memberQuery}
                        onChange={e => setMemberQuery(e.target.value)}
                        placeholder="Search by name or email…"
                        className="w-full border border-violet-200 rounded-xl pl-8 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 bg-violet-50/40"
                        autoFocus
                      />
                      {memberSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-20">
                          {memberSuggestions.map(user => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => addIndividualMember(user)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
                            >
                              <Avatar avatarUrl={user.avatar_url} name={user.full_name} size={28} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-700 truncate">{user.full_name}</p>
                                <p className="text-xs text-slate-400 truncate">{user.email}</p>
                              </div>
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 capitalize flex-shrink-0">
                                {user.role}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Selected individual members */}
                    {individualMembers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {individualMembers.map(member => (
                          <span
                            key={member.id}
                            className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-xs font-medium"
                          >
                            <Avatar avatarUrl={member.avatar_url} name={member.full_name} size={16} />
                            {member.full_name}
                            <button
                              type="button"
                              onClick={() => removeIndividualMember(member.id)}
                              className="text-violet-400 hover:text-violet-700 transition-colors ml-0.5"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                  {/* ── All privileged staff: inclusive checkbox picker ── */}
                {useInclusivePicker && (
                  <div className="space-y-3">
                    {/* Students section */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setIncludeStudents(prev => !prev)
                          if (includeStudents) {
                            setAllStudents(false)
                            setSelectedGrades([])
                            setSelectedSections({})
                          }
                        }}
                        className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                          includeStudents ? 'bg-mps-blue-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          includeStudents ? 'bg-mps-blue-500 border-mps-blue-500' : 'border-slate-300'
                        }`}>
                          {includeStudents && <Check size={12} className="text-white" />}
                        </div>
                        <GraduationCap size={16} className={includeStudents ? 'text-mps-blue-600' : 'text-slate-400'} />
                        <span className={`text-sm font-semibold ${includeStudents ? 'text-mps-blue-700' : 'text-slate-600'}`}>
                          Students
                        </span>
                        {isCoordinator && availableGrades.length < 12 && (
                          <span className="ml-auto text-xs text-amber-600 font-normal">Limited to your team&apos;s grades</span>
                        )}
                      </button>

                      {includeStudents && (
                        <div className="p-3 pt-0 border-t border-slate-100">
                          <StudentPicker />
                        </div>
                      )}
                    </div>

                    {/* Staff section */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setIncludeStaff(prev => !prev)
                          if (includeStaff) { setAllStaff(false); setSelectedTeamIds([]) }
                        }}
                        className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                          includeStaff ? 'bg-purple-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          includeStaff ? 'bg-purple-500 border-purple-500' : 'border-slate-300'
                        }`}>
                          {includeStaff && <Check size={12} className="text-white" />}
                        </div>
                        <Users size={16} className={includeStaff ? 'text-purple-600' : 'text-slate-400'} />
                        <span className={`text-sm font-semibold ${includeStaff ? 'text-purple-700' : 'text-slate-600'}`}>
                          Staff
                        </span>
                        {isCoordinator && availableTeams.length > 0 && (
                          <span className="ml-auto text-xs text-amber-600 font-normal">Limited to your team</span>
                        )}
                      </button>

                      {includeStaff && (
                        <div className="p-3 pt-0 border-t border-slate-100">
                          <StaffPicker />
                        </div>
                      )}
                    </div>

                    {!includeStudents && !includeStaff && (
                      <p className="text-xs text-amber-600 flex items-center gap-1.5">
                        <AlertCircle size={13} /> Select at least one audience group.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !canSubmit()}
                className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {submitting ? 'Publishing...' : 'Publish Announcement'}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
