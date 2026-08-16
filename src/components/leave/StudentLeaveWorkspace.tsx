'use client'

import React, {
  useState, useEffect, useCallback, useRef,
  forwardRef, useImperativeHandle,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import {
  CalendarDays, Clock, History, Search, X,
  Paperclip, ImageIcon, File, AlertTriangle,
} from 'lucide-react'
import LeaveAppList from './LeaveAppList'
import LeaveApplicationDetailModal from './LeaveApplicationDetailModal'
import LeaveStatsCard from './LeaveStatsCard'
import {
  LeaveStats,
  LEAVE_TYPE_LABELS,
  fetchMyLeaveApplicationsPage,
  fetchLeaveStats,
  fetchAllLeaveApplicationsPage,
  fetchApprovalQueueIds,
  fetchLeaveApplicationsByIdsPage,
  searchLeaveRecipients,
  createStudentLeaveApplication,
  isImageFile,
  RecipientProfile,
  type LeaveApplicationWithDetails,
} from '@/lib/leave'
import { usePagedLeaveLists } from '@/hooks/usePagedLeaveLists'
import { useStudentLeaveNotifications } from '@/hooks/useLeaveNotifications'

type TabId = 'pending' | 'reviewed'
type ListId = TabId | 'all'

const ROLE_LABEL: Record<string, string> = {
  teacher: 'Teacher', coordinator: 'Coordinator', principal: 'Principal', admin: 'Admin',
}
const ROLE_COLOR: Record<string, string> = {
  teacher: 'text-blue-600 bg-blue-50',
  coordinator: 'text-purple-600 bg-purple-50',
  principal: 'text-amber-700 bg-amber-50',
  admin: 'text-rose-600 bg-rose-50',
}

function EmptyState({ icon: Icon, text, action }: { icon: React.ElementType; text: string; action?: React.ReactNode }) {
  return (
    <div className="glass-strong rounded-2xl p-10 text-center">
      <Icon size={36} className="text-slate-200 mx-auto mb-3" />
      <p className="text-slate-500 text-sm">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Lets a host (page banner or popup header) drive the workspace's own controls. */
export interface StudentLeaveWorkspaceHandle {
  /** Opens the new-application form, or closes it if it's already showing. */
  toggleForm: () => void
  /** Opens a blank new-application form, optionally prefilled for a date range. */
  openNewApplication: (startDate?: string, endDate?: string) => void
  /** Opens one application's detail popup. */
  openApplication: (id: string) => void
}

export interface StudentLeaveWorkspaceProps {
  /**
   * Renders for a popup host instead of a full page: tighter vertical rhythm,
   * and the nested detail popup stacks above the host's own overlay.
   */
  embedded?: boolean
  /** Prefills and opens the new-application form for this date (deep link). */
  initialNewDate?: string | null
  /** Last day of a prefilled range; defaults to initialNewDate for one day. */
  initialNewEndDate?: string | null
  /** Opens this application's detail popup (deep link). */
  initialAppId?: string | null
  /** Fires whenever the form opens/closes, so a host can flip its + / × icon. */
  onFormOpenChange?: (open: boolean) => void
  /** Page mode uses this to drop ?openApp= from the URL when the popup closes. */
  onDetailClose?: () => void
}

/**
 * The Student OD / Leave app itself — the student's stats, form and Pending /
 * Reviewed tabs, and for staff the approval queue (plus, for principals and
 * admins, every student application).
 *
 * Deliberately chrome-free: no banner, no page padding, no ProtectedLayout.
 * `/more/leave` wraps it in page furniture; StudentLeaveModal wraps the same
 * component in a popup so Student Attendance can host the whole app without
 * sending anyone to a second screen.
 */
const StudentLeaveWorkspace = forwardRef<StudentLeaveWorkspaceHandle, StudentLeaveWorkspaceProps>(function StudentLeaveWorkspace({
  embedded = false,
  initialNewDate = null,
  initialNewEndDate = null,
  initialAppId = null,
  onFormOpenChange,
  onDetailClose,
}, ref) {
  const { user, profile } = useAuth()
  const isStudent = profile?.role === 'student'
  const isPrincipalOrAdmin = profile?.role === 'principal' || profile?.role === 'admin'

  const { markAllRead: markLeaveRead } = useStudentLeaveNotifications(user?.id ?? null, isStudent ?? false)
  useEffect(() => { markLeaveRead() }, [markLeaveRead])

  const [activeTab, setActiveTab] = useState<TabId>('pending')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  // Every list here is paged: 10 rows up front, 10 more on request.
  const { get, load, loadMore } = usePagedLeaveLists<ListId>()
  const pendingList = get('pending')
  const reviewedList = get('reviewed')
  const allList = get('all')

  const [stats, setStats] = useState<LeaveStats>({ applied: 0, approved: 0, pending: 0, rejected: 0 })

  // One application opened on its own, fetched by id instead of loading the
  // list it happens to sit in.
  const [detailAppId, setDetailAppId] = useState<string | null>(initialAppId)
  useEffect(() => { setDetailAppId(initialAppId) }, [initialAppId])

  // A leave picked from a card's attendance calendar opens in place — swapping
  // the detail popup — instead of navigating to the standalone page.
  const viewLeave = useCallback((app: LeaveApplicationWithDetails) => {
    setDetailAppId(app.id)
  }, [])

  const closeDetail = useCallback(() => {
    setDetailAppId(null)
    onDetailClose?.()
  }, [onDetailClose])

  // ── Form state ──────────────────────────────────────────────────────────────
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipientResults, setRecipientResults] = useState<RecipientProfile[]>([])
  const [selectedRecipient, setSelectedRecipient] = useState<RecipientProfile | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [leaveType, setLeaveType] = useState<'casual' | 'medical' | 'on_duty'>('casual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [attachFile, setAttachFile] = useState<File | null>(null)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => { onFormOpenChange?.(showForm) }, [showForm, onFormOpenChange])

  /**
   * Loads the first page of every list this role sees, in parallel.
   *
   * Students page their own applications by tab status; staff page the two
   * halves of their approval queue. The queue's id lookup is the only step
   * that has to happen before the rest — everything after it is one round of
   * concurrent 10-row queries rather than a chain of full-table reads.
   */
  const loadData = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    if (isStudent) {
      await Promise.all([
        load('pending', (offset, limit) =>
          fetchMyLeaveApplicationsPage(user.id, { offset, limit, statuses: ['pending'] })),
        load('reviewed', (offset, limit) =>
          fetchMyLeaveApplicationsPage(user.id, { offset, limit, statuses: ['approved', 'rejected'] })),
        fetchLeaveStats(user.id).then(setStats),
      ])
    } else {
      const { pendingIds, decidedIds } = await fetchApprovalQueueIds(user.id)
      await Promise.all([
        load('pending', (offset, limit) =>
          fetchLeaveApplicationsByIdsPage(pendingIds, 'student', { offset, limit })),
        load('reviewed', (offset, limit) =>
          fetchLeaveApplicationsByIdsPage(decidedIds, 'student', { offset, limit })),
        ...(isPrincipalOrAdmin
          ? [load('all', (offset, limit) => fetchAllLeaveApplicationsPage('student', { offset, limit }))]
          : []),
      ])
    }
    setLoading(false)
  }, [user, profile, isStudent, isPrincipalOrAdmin, load])

  useEffect(() => { loadData() }, [loadData])

  const resetForm = useCallback(() => {
    setSelectedRecipient(null); setRecipientQuery(''); setRecipientResults([])
    setLeaveType('casual'); setStartDate(''); setEndDate('')
    setReason(''); setAttachFile(null); setFormError('')
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const openNewApplication = useCallback((start?: string, end?: string) => {
    resetForm()
    if (start) { setStartDate(start); setEndDate(end && end >= start ? end : start) }
    setActiveTab('pending')
    setShowForm(true)
  }, [resetForm])

  useImperativeHandle(ref, () => ({
    toggleForm: () => setShowForm(open => {
      if (!open) resetForm()
      return !open
    }),
    openNewApplication,
    openApplication: (id: string) => setDetailAppId(id),
  }), [resetForm, openNewApplication])

  // Deep link: open a prefilled new application for a specific date. Handled
  // once — closing the detail popup rewrites the query string, and that must
  // not spring the form back open.
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (deepLinkHandled.current || !isStudent || !initialNewDate) return
    deepLinkHandled.current = true
    openNewApplication(initialNewDate, initialNewEndDate ?? undefined)
  }, [isStudent, initialNewDate, initialNewEndDate, openNewApplication])

  // Recipient search debounce
  useEffect(() => {
    if (selectedRecipient) { setRecipientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (recipientQuery.trim().length < 2) { setRecipientResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      setRecipientResults(await searchLeaveRecipients(recipientQuery))
      setSearchLoading(false)
    }, 280)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [recipientQuery, selectedRecipient])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setRecipientResults([])
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!selectedRecipient) { setFormError('Please select who to send this to.'); return }
    if (!startDate || !endDate) { setFormError('Please select start and end dates.'); return }
    if (endDate < startDate) { setFormError('End date must be on or after start date.'); return }
    if (!reason.trim()) { setFormError('Please provide a reason.'); return }

    setSubmitting(true); setFormError('')
    const result = await createStudentLeaveApplication(
      { leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason.trim() },
      user.id, selectedRecipient.id, selectedRecipient.role,
      attachFile ?? undefined,
    )
    setSubmitting(false)
    if (result) { resetForm(); setShowForm(false); await loadData(); setActiveTab('pending') }
    else setFormError('Failed to submit. Please try again.')
  }

  if (!user || !profile) return null

  const detailPopup = (
    <LeaveApplicationDetailModal
      applicationId={detailAppId}
      currentUserId={user.id}
      currentUserRole={profile.role}
      canDelete={isPrincipalOrAdmin}
      onClose={closeDetail}
      onChanged={loadData}
      onViewLeave={viewLeave}
      // Embedded, this has to clear the host popup, which ModalShell puts at
      // z-50. Matching that (rather than beating it) keeps the card's own
      // review / attendance / delete popups — also z-50, but portalled later —
      // on top of this one, which is the order the card assumes.
      zClass={embedded ? 'z-50' : undefined}
    />
  )

  const tabs = (active: number, history: number) => (
    <div className="flex items-stretch bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-5">
      {([
        { id: 'pending' as TabId, label: 'Pending', Icon: Clock, count: active },
        { id: 'reviewed' as TabId, label: 'Reviewed', Icon: History, count: history },
      ]).map(({ id, label, Icon, count }, i) => (
        <button
          key={id}
          onClick={() => setActiveTab(id)}
          className={`relative flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
            i > 0 ? 'border-l border-slate-100' : ''
          } ${activeTab === id ? 'page-tab-line-active' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
        >
          <Icon size={13} />
          <span>{label}</span>
          {count > 0 && (
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
              activeTab === id ? 'page-tab-line-badge' : 'bg-slate-100 text-slate-400'
            }`}>
              {count}
            </span>
          )}
          <span className={`absolute left-3 right-3 bottom-0 h-[2.5px] rounded-t-full transition-colors ${
            activeTab === id ? 'page-tab-line-indicator' : 'bg-transparent'
          }`} />
        </button>
      ))}
    </div>
  )

  // ── STUDENT VIEW ────────────────────────────────────────────
  if (isStudent) {
    return (
      <>
        <div className="mb-5">
          <LeaveStatsCard stats={stats} />
        </div>

        {/* Application form */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-5 overflow-hidden"
            >
              <form onSubmit={handleSubmit} className="glass-strong rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-slate-800">New OD / Leave Application</h2>
                  <button type="button" onClick={() => { setShowForm(false); resetForm() }} className="p-1 text-slate-400 hover:text-slate-600">
                    <X size={18} />
                  </button>
                </div>

                {/* Recipient search */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Send To <span className="text-slate-400 font-normal">– Teacher / Coordinator / Principal / Admin</span>
                  </label>
                  <div ref={searchRef} className="relative">
                    <div className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 bg-white transition-colors ${
                      selectedRecipient ? '' : 'border-slate-200 page-focus-within'
                    }`} style={selectedRecipient ? { borderColor: 'var(--page-primary)' } : undefined}>
                      {selectedRecipient ? <Avatar avatarUrl={selectedRecipient.avatar_url} name={selectedRecipient.full_name} size={22} /> : <Search size={14} className="text-slate-400 flex-shrink-0" />}
                      <input
                        type="text"
                        value={recipientQuery}
                        onChange={e => { setRecipientQuery(e.target.value); if (selectedRecipient) setSelectedRecipient(null) }}
                        placeholder="Search by name or email…"
                        className="flex-1 bg-transparent text-sm focus:outline-none text-slate-700 placeholder:text-slate-400"
                        autoComplete="off"
                      />
                      {searchLoading && <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: 'var(--page-primary)', borderTopColor: 'transparent' }} />}
                      {selectedRecipient && (
                        <button type="button" onClick={() => { setSelectedRecipient(null); setRecipientQuery('') }} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    {selectedRecipient && (
                      <div className="mt-1.5 flex items-center gap-2 px-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOR[selectedRecipient.role] ?? 'bg-slate-100 text-slate-600'}`}>
                          {ROLE_LABEL[selectedRecipient.role] ?? selectedRecipient.role}
                        </span>
                        <span className="text-xs text-slate-700 font-medium">{selectedRecipient.full_name}</span>
                      </div>
                    )}

                    <AnimatePresence>
                      {recipientResults.length > 0 && !selectedRecipient && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                          className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-lg z-20 overflow-hidden"
                        >
                          {recipientResults.map(r => (
                            <button key={r.id} type="button" onClick={() => { setSelectedRecipient(r); setRecipientQuery(r.full_name); setRecipientResults([]) }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left transition-colors border-b border-slate-50 last:border-0">
                              <Avatar avatarUrl={r.avatar_url} name={r.full_name} size={32} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{r.full_name}</p>
                                <p className="text-xs text-slate-500 truncate">{r.email}</p>
                              </div>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${ROLE_COLOR[r.role] ?? 'bg-slate-100 text-slate-600'}`}>
                                {ROLE_LABEL[r.role] ?? r.role}
                              </span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Leave type */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Application Type</label>
                  <div className="flex flex-col gap-2">
                    {(['on_duty', 'casual', 'medical'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setLeaveType(t)}
                        className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium border transition-colors text-left ${
                          leaveType === t ? 'page-type-btn-active' : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}>
                        {LEAVE_TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">From <span className="text-red-500">*</span></label>
                    <input type="date" value={startDate} min={today}
                      onChange={e => { setStartDate(e.target.value); if (endDate && e.target.value > endDate) setEndDate(e.target.value) }}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none page-input-focus" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">To <span className="text-red-500">*</span></label>
                    <input type="date" value={endDate} min={startDate || today}
                      onChange={e => setEndDate(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none page-input-focus" />
                  </div>
                </div>

                {/* Reason + attachment */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Reason <span className="text-red-500">*</span></label>
                  <textarea value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Briefly describe your reason for leave…"
                    rows={3}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none page-input-focus resize-none" />

                  {/* Attachment */}
                  <div className="mt-2">
                    {!attachFile ? (
                      <button type="button" onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-xl text-xs text-slate-500 page-attach-btn transition-colors w-full">
                        <Paperclip size={13} />
                        Attach image or document (optional)
                      </button>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                          {isImageFile(attachFile.name) ? <ImageIcon size={13} className="text-blue-500 flex-shrink-0" /> : <File size={13} className="text-slate-400 flex-shrink-0" />}
                          <span className="text-xs text-slate-700 flex-1 min-w-0 truncate">{attachFile.name}</span>
                          <button type="button" onClick={() => { setAttachFile(null); if (fileRef.current) fileRef.current.value = '' }} className="text-slate-400 hover:text-red-500 flex-shrink-0">
                            <X size={13} />
                          </button>
                        </div>
                        {isImageFile(attachFile.name) && (
                          <img src={URL.createObjectURL(attachFile)} alt={attachFile.name}
                            className="rounded-xl max-h-48 max-w-full object-contain border border-slate-100" />
                        )}
                      </div>
                    )}
                    <input ref={fileRef} type="file" className="hidden"
                      accept="image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx"
                      onChange={e => { const f = e.target.files?.[0]; if (f) setAttachFile(f) }} />
                  </div>
                </div>

                {formError && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    <AlertTriangle size={13} /> {formError}
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => { setShowForm(false); resetForm() }} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting || !selectedRecipient || !startDate || !endDate || !reason.trim()}
                    className="btn-primary text-sm px-5 py-2 disabled:opacity-50 flex items-center gap-2">
                    {submitting && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    {submitting ? 'Submitting…' : 'Submit Application'}
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {tabs(pendingList.total, reviewedList.total)}

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            {loading ? (
              <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
            ) : activeTab === 'pending' ? (
              pendingList.items.length === 0
                ? <EmptyState icon={CalendarDays} text="No pending applications"
                    action={<button onClick={() => openNewApplication()} className="text-sm page-text-link font-medium">Apply for OD/Leave</button>} />
                : <LeaveAppList list={pendingList} userId={user.id} role={profile.role} isApprover={false} onRefresh={loadData} onLoadMore={() => loadMore('pending')} onViewLeave={viewLeave} />
            ) : (
              reviewedList.items.length === 0
                ? <EmptyState icon={History} text="No reviewed applications yet" />
                : <LeaveAppList list={reviewedList} userId={user.id} role={profile.role} isApprover={false} onRefresh={loadData} onLoadMore={() => loadMore('reviewed')} onViewLeave={viewLeave} />
            )}
          </motion.div>
        </AnimatePresence>

        {detailPopup}
      </>
    )
  }

  // ── STAFF / ADMIN VIEW ──────────────────────────────────────
  return (
    <>
      {tabs(pendingList.total, reviewedList.total)}

      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
          ) : activeTab === 'pending' ? (
            pendingList.items.length === 0
              ? <EmptyState icon={Clock} text="No pending applications to review" />
              : <LeaveAppList list={pendingList} userId={user.id} role={profile.role} isApprover={true} onRefresh={loadData} onLoadMore={() => loadMore('pending')} onViewLeave={viewLeave} />
          ) : (
            reviewedList.items.length === 0
              ? <EmptyState icon={History} text="No reviewed applications yet" />
              : <LeaveAppList list={reviewedList} userId={user.id} role={profile.role} isApprover={false} onRefresh={loadData} onLoadMore={() => loadMore('reviewed')} onViewLeave={viewLeave} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── PRINCIPAL / ADMIN: All Applications overview ── */}
      {isPrincipalOrAdmin && (
        <div className={`${embedded ? 'mt-8 pt-6' : 'mt-10 pt-8'} border-t border-slate-200`}>
          <h2 className="font-bold text-slate-800 mb-4">All Student Applications</h2>
          {loading ? (
            <div className="text-center py-8"><div className="spinner mx-auto mb-3" /></div>
          ) : allList.items.length === 0
            ? <EmptyState icon={CalendarDays} text="No applications yet" />
            : <LeaveAppList list={allList} userId={user.id} role={profile.role} isApprover={true} canDelete={true} onRefresh={loadData} onLoadMore={() => loadMore('all')} onViewLeave={viewLeave} />
          }
        </div>
      )}

      {detailPopup}
    </>
  )
})

export default StudentLeaveWorkspace
