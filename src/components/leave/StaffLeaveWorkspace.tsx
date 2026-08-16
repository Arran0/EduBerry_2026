'use client'

import React, {
  useState, useEffect, useCallback, useRef,
  forwardRef, useImperativeHandle,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import {
  Plus, Send, Inbox, X, Search,
  Paperclip, ImageIcon, File, AlertTriangle, CalendarDays,
} from 'lucide-react'
import LeaveAppList from './LeaveAppList'
import LeaveApplicationDetailModal from './LeaveApplicationDetailModal'
import {
  LeaveType,
  LEAVE_TYPE_LABELS,
  fetchMyLeaveApplicationsPage,
  fetchApprovalQueueIds,
  fetchLeaveApplicationsByIdsPage,
  fetchAllLeaveApplicationsPage,
  countLeaveApplicationsByIds,
  searchLeaveRecipients,
  createStudentLeaveApplication,
  isImageFile,
  RecipientProfile,
  type LeaveApplicationWithDetails,
} from '@/lib/leave'
import { usePagedLeaveLists } from '@/hooks/usePagedLeaveLists'
import { useStaffLeaveNotifications } from '@/hooks/useLeaveNotifications'

type TabId = 'sent' | 'received'
type ListId = TabId | 'all'

const ROLE_LABEL: Record<string, string> = {
  coordinator: 'Coordinator',
  principal: 'Principal',
  admin: 'Admin',
}
const ROLE_COLOR: Record<string, string> = {
  coordinator: 'text-purple-600 bg-purple-50',
  principal: 'text-amber-700 bg-amber-50',
  admin: 'text-rose-600 bg-rose-50',
}

function EmptyState({
  icon: Icon, text, action,
}: {
  icon: React.ElementType
  text: string
  action?: React.ReactNode
}) {
  return (
    <div className="glass-strong rounded-2xl p-10 text-center">
      <Icon size={36} className="text-slate-200 mx-auto mb-3" />
      <p className="text-slate-500 text-sm">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

async function searchStaffRecipients(query: string): Promise<RecipientProfile[]> {
  const results = await searchLeaveRecipients(query)
  return results.filter(r => ['coordinator', 'principal', 'admin'].includes(r.role))
}

/** Lets a host (page banner or popup header) drive the workspace's own controls. */
export interface StaffLeaveWorkspaceHandle {
  /** Opens the new-application form, or closes it if it's already showing. */
  toggleForm: () => void
  /** Opens a blank new-application form, optionally prefilled for one date. */
  openNewApplication: (date?: string) => void
  /** Opens one application's detail popup. */
  openApplication: (id: string) => void
}

export interface StaffLeaveWorkspaceProps {
  /**
   * Renders for a popup host instead of a full page: tighter vertical rhythm,
   * and the nested detail popup stacks above the host's own overlay.
   */
  embedded?: boolean
  /** Prefills and opens the new-application form for this date (deep link). */
  initialNewDate?: string | null
  /** Opens this application's detail popup (deep link). */
  initialAppId?: string | null
  /** Fires whenever the form opens/closes, so a host can flip its + / × icon. */
  onFormOpenChange?: (open: boolean) => void
  /** Page mode uses this to drop ?app= from the URL when the popup closes. */
  onDetailClose?: () => void
}

/**
 * The Staff OD / Leave app itself — form, Sent / Received tabs, and (for
 * principals and admins) the all-applications list.
 *
 * Deliberately chrome-free: no banner, no page padding, no ProtectedLayout.
 * `/more/staff-leave` wraps it in page furniture; StaffLeaveModal wraps the
 * same component in a popup so Staff Attendance can host the whole app
 * without sending anyone to a second screen.
 */
const StaffLeaveWorkspace = forwardRef<StaffLeaveWorkspaceHandle, StaffLeaveWorkspaceProps>(function StaffLeaveWorkspace({
  embedded = false,
  initialNewDate = null,
  initialAppId = null,
  onFormOpenChange,
  onDetailClose,
}, ref) {
  const { user, profile } = useAuth()

  const isAdmin            = profile?.role === 'admin'
  const isPrincipal        = profile?.role === 'principal'
  const isPrincipalOrAdmin = isAdmin || isPrincipal

  const { markAllRead: markStaffLeaveRead } = useStaffLeaveNotifications(user?.id ?? null)
  useEffect(() => { markStaffLeaveRead() }, [markStaffLeaveRead])

  const [activeTab, setActiveTab] = useState<TabId>('sent')
  const [showForm, setShowForm]   = useState(false)
  const [loading, setLoading]     = useState(true)

  // Every list here is paged: 10 rows up front, 10 more on request.
  const { get, load, loadMore } = usePagedLeaveLists<ListId>()
  const sentList     = get('sent')
  const receivedList = get('received')
  const allList      = get('all')
  const [receivedPendingCount, setReceivedPendingCount] = useState(0)

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
  const [recipientInput,   setRecipientInput]   = useState('')
  const [recipientResults, setRecipientResults] = useState<RecipientProfile[]>([])
  const [selectedRecipient, setSelectedRecipient] = useState<RecipientProfile | null>(null)
  const [searchLoading, setSearchLoading]       = useState(false)
  const searchRef   = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileRef     = useRef<HTMLInputElement>(null)

  const [leaveType,   setLeaveType]   = useState<LeaveType>('on_duty')
  const [startDate,   setStartDate]   = useState('')
  const [endDate,     setEndDate]     = useState('')
  const [reason,      setReason]      = useState('')
  const [attachFile,  setAttachFile]  = useState<File | null>(null)
  const [formError,   setFormError]   = useState('')
  const [submitting,  setSubmitting]  = useState(false)

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => { onFormOpenChange?.(showForm) }, [showForm, onFormOpenChange])

  /**
   * Loads the first page of each list in parallel. The approval queue's id
   * lookup is the only step the others wait on — after it, every list is one
   * concurrent 10-row query instead of a chain of full-table reads.
   */
  const loadData = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)

    const { pendingIds, decidedIds } = await fetchApprovalQueueIds(user.id)
    const receivedIds = [...pendingIds, ...decidedIds]

    await Promise.all([
      load('sent', (offset, limit) => fetchMyLeaveApplicationsPage(user.id, { offset, limit })),
      load('received', (offset, limit) =>
        fetchLeaveApplicationsByIdsPage(receivedIds, 'staff', { offset, limit })),
      // Badge only — counted in the database rather than by scanning rows.
      countLeaveApplicationsByIds(pendingIds, 'staff').then(setReceivedPendingCount),
      ...(isPrincipalOrAdmin
        ? [load('all', (offset, limit) => fetchAllLeaveApplicationsPage('staff', { offset, limit }))]
        : []),
    ])
    setLoading(false)
  }, [user, profile, isPrincipalOrAdmin, load])

  useEffect(() => { loadData() }, [loadData])

  const resetForm = useCallback(() => {
    setSelectedRecipient(null); setRecipientInput(''); setRecipientResults([])
    setLeaveType('on_duty'); setStartDate(''); setEndDate('')
    setReason(''); setAttachFile(null); setFormError('')
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const openNewApplication = useCallback((date?: string) => {
    resetForm()
    if (date) { setStartDate(date); setEndDate(date) }
    setActiveTab('sent')
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
  // once — reopening the form later shouldn't drag the old date back in.
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (deepLinkHandled.current || !initialNewDate) return
    deepLinkHandled.current = true
    openNewApplication(initialNewDate)
  }, [initialNewDate, openNewApplication])

  // Recipient search debounce
  useEffect(() => {
    if (selectedRecipient) { setRecipientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (recipientInput.trim().length < 2) { setRecipientResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      setRecipientResults(await searchStaffRecipients(recipientInput))
      setSearchLoading(false)
    }, 280)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [recipientInput, selectedRecipient])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setRecipientResults([])
      }
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
    const normalizedReason = reason.trim().replace(/\n{2,}/g, '\n')
    const result = await createStudentLeaveApplication(
      { leave_type: leaveType, start_date: startDate, end_date: endDate, reason: normalizedReason },
      user.id, selectedRecipient.id, selectedRecipient.role,
      attachFile ?? undefined,
    )
    setSubmitting(false)
    if (result) {
      resetForm(); setShowForm(false); await loadData(); setActiveTab('sent')
    } else {
      setFormError('Failed to submit. Please try again.')
    }
  }

  if (!user || !profile) return null

  const leaveDays = startDate && endDate && endDate >= startDate
    ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : null

  return (
    <>
      {/* ── New Application Form ── */}
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
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm() }}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Recipient search */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Send To <span className="text-slate-400 font-normal">– Coordinator / Principal / Admin</span>
                </label>
                <div ref={searchRef} className="relative">
                  <div className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 bg-white transition-colors ${
                    selectedRecipient ? '' : 'border-slate-200 page-focus-within'
                  }`} style={selectedRecipient ? { borderColor: 'var(--page-primary)' } : undefined}>
                    {selectedRecipient
                      ? <Avatar avatarUrl={selectedRecipient.avatar_url} name={selectedRecipient.full_name} size={22} />
                      : <Search size={14} className="text-slate-400 flex-shrink-0" />
                    }
                    <input
                      type="text"
                      value={recipientInput}
                      onChange={e => {
                        setRecipientInput(e.target.value)
                        if (selectedRecipient) setSelectedRecipient(null)
                      }}
                      placeholder="Search by name or email…"
                      className="flex-1 bg-transparent text-sm focus:outline-none text-slate-700 placeholder:text-slate-400"
                      autoComplete="off"
                    />
                    {searchLoading && (
                      <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: 'var(--page-primary)', borderTopColor: 'transparent' }} />
                    )}
                    {selectedRecipient && (
                      <button
                        type="button"
                        onClick={() => { setSelectedRecipient(null); setRecipientInput('') }}
                        className="text-slate-400 hover:text-slate-600 flex-shrink-0"
                      >
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
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-lg z-20 overflow-hidden"
                      >
                        {recipientResults.map(r => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setSelectedRecipient(r)
                              setRecipientInput(r.full_name)
                              setRecipientResults([])
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left transition-colors border-b border-slate-50 last:border-0"
                          >
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
                <div className="flex gap-2">
                  {(['on_duty', 'casual', 'medical'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setLeaveType(t)}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                        leaveType === t
                          ? 'page-type-btn-active'
                          : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {LEAVE_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">From <span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    value={startDate}
                    min={today}
                    onChange={e => {
                      setStartDate(e.target.value)
                      if (endDate && e.target.value > endDate) setEndDate(e.target.value)
                    }}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none page-input-focus"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">To <span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || today}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none page-input-focus"
                  />
                </div>
              </div>
              {leaveDays !== null && (
                <p className="text-xs page-accent-text font-medium -mt-1">
                  {leaveDays} day{leaveDays !== 1 ? 's' : ''}
                </p>
              )}

              {/* Reason */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Reason <span className="text-red-500">*</span></label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Briefly describe your reason for leave…"
                  rows={3}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none page-input-focus resize-none"
                />

                {/* Attachment */}
                <div className="mt-2">
                  {!attachFile ? (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-xl text-xs text-slate-500 page-attach-btn transition-colors w-full"
                    >
                      <Paperclip size={13} />
                      Attach image or document (optional)
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                        {isImageFile(attachFile.name)
                          ? <ImageIcon size={13} className="page-accent-text flex-shrink-0" />
                          : <File size={13} className="text-slate-400 flex-shrink-0" />
                        }
                        <span className="text-xs text-slate-700 flex-1 min-w-0 truncate">{attachFile.name}</span>
                        <button
                          type="button"
                          onClick={() => { setAttachFile(null); if (fileRef.current) fileRef.current.value = '' }}
                          className="text-slate-400 hover:text-red-500 flex-shrink-0"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {isImageFile(attachFile.name) && (
                        <img
                          src={URL.createObjectURL(attachFile)}
                          alt={attachFile.name}
                          className="rounded-xl max-h-48 max-w-full object-contain border border-slate-100"
                        />
                      )}
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setAttachFile(f) }}
                  />
                </div>
              </div>

              {formError && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  <AlertTriangle size={13} /> {formError}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm() }}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedRecipient || !startDate || !endDate || !reason.trim()}
                  className="btn-primary text-sm px-5 py-2 disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting && (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {submitting ? 'Submitting…' : 'Submit Application'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tabs ── */}
      <div className="flex items-stretch bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-5">
        {([
          { id: 'sent'     as TabId, label: 'Sent',     Icon: Send,  count: sentList.total,     badge: 0 },
          { id: 'received' as TabId, label: 'Received', Icon: Inbox, count: receivedList.total, badge: receivedPendingCount },
        ]).map(({ id, label, Icon, count, badge }, i) => (
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
            {badge > 0 && activeTab !== id && (
              <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
            )}
            <span className={`absolute left-3 right-3 bottom-0 h-[2.5px] rounded-t-full transition-colors ${
              activeTab === id ? 'page-tab-line-indicator' : 'bg-transparent'
            }`} />
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {loading ? (
            <div className="text-center py-12">
              <div className="spinner mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading…</p>
            </div>
          ) : activeTab === 'sent' ? (
            sentList.items.length === 0 ? (
              <EmptyState
                icon={Send}
                text="No applications sent yet"
                action={
                  <button
                    onClick={() => openNewApplication()}
                    className="text-sm page-text-link font-medium"
                  >
                    Send a new application
                  </button>
                }
              />
            ) : (
              <LeaveAppList
                list={sentList}
                userId={user.id}
                role={profile.role}
                isApprover={false}
                onRefresh={loadData}
                onLoadMore={() => loadMore('sent')}
                onViewLeave={viewLeave}
              />
            )
          ) : (
            receivedList.items.length === 0 ? (
              <EmptyState icon={Inbox} text="No applications received yet" />
            ) : (
              <LeaveAppList
                list={receivedList}
                userId={user.id}
                role={profile.role}
                isApprover={true}
                onRefresh={loadData}
                onLoadMore={() => loadMore('received')}
                onViewLeave={viewLeave}
              />
            )
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Principal / Admin: All Staff Applications ── */}
      {isPrincipalOrAdmin && !loading && (
        <div className={`${embedded ? 'mt-8 pt-6' : 'mt-10 pt-8'} border-t border-slate-200`}>
          <h2 className="font-bold text-slate-800 mb-4">All Staff Applications</h2>
          {allList.items.length === 0 ? (
            <EmptyState icon={CalendarDays} text="No applications on record" />
          ) : (
            <LeaveAppList
              list={allList}
              userId={user.id}
              role={profile.role}
              isApprover={true}
              canDelete={true}
              onRefresh={loadData}
              onLoadMore={() => loadMore('all')}
              onViewLeave={viewLeave}
            />
          )}
        </div>
      )}

      <LeaveApplicationDetailModal
        applicationId={detailAppId}
        currentUserId={user.id}
        currentUserRole={profile.role}
        canDelete={isPrincipalOrAdmin}
        onClose={closeDetail}
        onChanged={loadData}
        onViewLeave={viewLeave}
        // Embedded, this popup opens on top of the host popup (z-40) rather
        // than behind it.
        zClass={embedded ? 'z-[45]' : undefined}
      />
    </>
  )
})

export default StaffLeaveWorkspace
