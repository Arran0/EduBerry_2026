'use client'

import React, {
  useState, useEffect, useCallback, useRef,
  forwardRef, useImperativeHandle,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import {
  Send, Inbox, X, Search,
  Paperclip, ImageIcon, File, AlertTriangle, CalendarDays, Layers,
} from 'lucide-react'
import LeaveAppList from './LeaveAppList'
import LeaveApplicationDetailModal from './LeaveApplicationDetailModal'
import {
  LeaveType,
  LEAVE_TYPE_LABELS,
  LEAVE_SEARCH_MIN_CHARS,
  fetchMyLeaveApplicationsPage,
  fetchApprovalQueueIds,
  fetchLeaveApplicationsByIdsPage,
  fetchAllLeaveApplicationsPage,
  countLeaveApplicationsByIds,
  countPendingLeaveApplications,
  searchLeaveRecipients,
  searchLeaveApplicationIdsByPerson,
  createStudentLeaveApplication,
  isImageFile,
  RecipientProfile,
} from '@/lib/leave'
import { usePagedLeaveLists } from '@/hooks/usePagedLeaveLists'
import { fetchUnreadDecisionItems, onLeaveNotificationsChanged } from '@/lib/leaveNotifications'

type TabId = 'all' | 'sent' | 'received'

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
    <div className="bg-[#FAF9F6] border border-[#27272A]/[0.06] rounded-[22px] px-6 py-10 text-center">
      <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] flex items-center justify-center">
        <Icon size={22} className="text-slate-300" />
      </div>
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
  /** Opens a blank new-application form, optionally prefilled for a date range. */
  openNewApplication: (startDate?: string, endDate?: string) => void
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
  /** Last day of a prefilled range; defaults to initialNewDate for one day. */
  initialNewEndDate?: string | null
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
  initialNewEndDate = null,
  initialAppId = null,
  onFormOpenChange,
  onDetailClose,
}, ref) {
  const { user, profile } = useAuth()

  const isAdmin            = profile?.role === 'admin'
  const isPrincipal        = profile?.role === 'principal'
  const isPrincipalOrAdmin = isAdmin || isPrincipal

  // Visiting the workspace no longer clears anything: a decision is read by
  // opening the application it belongs to (LeaveApplicationCard writes the
  // view row), and an application awaiting this user's decision stays unread
  // until they make it.

  const [activeTab, setActiveTab] = useState<TabId>('sent')
  const [showForm, setShowForm]   = useState(false)
  const [loading, setLoading]     = useState(true)

  // Every list here is paged: 10 rows up front, 10 more on request.
  const { get, load, loadMore } = usePagedLeaveLists<TabId>()
  const sentList     = get('sent')
  const receivedList = get('received')
  const allList      = get('all')
  // Unread tallies behind the tab counts — what is still owed an answer in
  // each folder, by the same rule the rows' unread rail uses (see
  // isLeaveUnreadFor). A folder with nothing outstanding shows no number.
  const [receivedPendingCount, setReceivedPendingCount] = useState(0)
  const [sentUnreadCount, setSentUnreadCount] = useState(0)
  const [allPendingCount, setAllPendingCount] = useState(0)
  const lastLoadedSearchGen = useRef(0)

  // ── Search ──────────────────────────────────────────────────────────────────
  // Typing resolves to a set of application ids (matched on either party's
  // name), which every list then intersects with. `null` means no search is
  // running; an empty array means one ran and matched nobody.
  const [searchInput, setSearchInput] = useState('')
  const [searchIds, setSearchIds]     = useState<string[] | null>(null)
  const [searching, setSearching]     = useState(false)
  // Bumped whenever a *different* search resolves, so the lists know to drop
  // back to their first page instead of re-requesting however many rows the
  // previous result set had grown to.
  const [searchGen, setSearchGen]     = useState(0)
  const appliedSearch = useRef<string[] | null>(null)
  const searchActive = searchInput.trim().length >= LEAVE_SEARCH_MIN_CHARS

  useEffect(() => {
    const term = searchInput.trim()
    if (term.length < LEAVE_SEARCH_MIN_CHARS) {
      setSearching(false)
      // Only reload when a search was actually in force — otherwise every
      // keystroke below the threshold would refetch all three lists.
      if (appliedSearch.current !== null) {
        appliedSearch.current = null
        setSearchIds(null)
        setSearchGen(g => g + 1)
      }
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      const ids = await searchLeaveApplicationIdsByPerson(term)
      appliedSearch.current = ids
      setSearchIds(ids)
      setSearchGen(g => g + 1)
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // One application opened on its own, fetched by id instead of loading the
  // list it happens to sit in.
  const [detailAppId, setDetailAppId] = useState<string | null>(initialAppId)
  useEffect(() => { setDetailAppId(initialAppId) }, [initialAppId])

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

    // A new search starts each list over at page one; a plain refresh (after a
    // decision, say) keeps whatever the user has already scrolled into view.
    const reset = lastLoadedSearchGen.current !== searchGen
    lastLoadedSearchGen.current = searchGen

    const { pendingIds, decidedIds } = await fetchApprovalQueueIds(user.id)
    const receivedIds = [...pendingIds, ...decidedIds]

    await Promise.all([
      load('sent', (offset, limit) =>
        fetchMyLeaveApplicationsPage(user.id, { offset, limit, restrictIds: searchIds }), reset),
      load('received', (offset, limit) =>
        fetchLeaveApplicationsByIdsPage(receivedIds, 'staff', { offset, limit, restrictIds: searchIds }), reset),
      // Tab counts only — resolved in the database rather than by scanning
      // rows, and deliberately unfiltered: they report what is outstanding,
      // not how many rows a search happened to match.
      // Received: applications still waiting on this reviewer's decision.
      countLeaveApplicationsByIds(pendingIds, 'staff').then(setReceivedPendingCount),
      // Sent: decisions on this user's own applications they have not read.
      fetchUnreadDecisionItems(user.id, 'staff').then(items => setSentUnreadCount(items.length)),
      // All: everything still awaiting somebody's decision.
      ...(isPrincipalOrAdmin
        ? [countPendingLeaveApplications('staff').then(setAllPendingCount)]
        : []),
      ...(isPrincipalOrAdmin
        ? [load('all', (offset, limit) =>
            fetchAllLeaveApplicationsPage('staff', { offset, limit, restrictIds: searchIds }), reset)]
        : []),
    ])
    setLoading(false)
  }, [user, profile, isPrincipalOrAdmin, load, searchIds, searchGen])

  useEffect(() => { loadData() }, [loadData])
  // A decision made here, or a notification read anywhere else, moves these
  // counts — reload rather than let the tabs drift out of date.
  useEffect(() => onLeaveNotificationsChanged(loadData), [loadData])

  const resetForm = useCallback(() => {
    setSelectedRecipient(null); setRecipientInput(''); setRecipientResults([])
    setLeaveType('on_duty'); setStartDate(''); setEndDate('')
    setReason(''); setAttachFile(null); setFormError('')
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const openNewApplication = useCallback((start?: string, end?: string) => {
    resetForm()
    if (start) { setStartDate(start); setEndDate(end && end >= start ? end : start) }
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
    openNewApplication(initialNewDate, initialNewEndDate ?? undefined)
  }, [initialNewDate, initialNewEndDate, openNewApplication])

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

  // The mail list runs to the surface's edge at every width — inside the popup
  // it is already sitting on a card, and boxing it in a second one would spend
  // width on nested borders. How far it has to pull back depends on the host:
  // the popup's glass body card is px-4 (px-5 from sm), the standalone page px-4.
  const listBleed = embedded ? '-mx-4 sm:-mx-5' : '-mx-4 sm:mx-0'

  // The number beside a folder is its unread count — what is waiting on
  // someone — not how many applications it holds. A total tells the user
  // nothing they need to act on; an unread count is the whole point of a badge.
  const tabs = [
    ...(isPrincipalOrAdmin
      ? [{ id: 'all' as TabId, label: 'All', Icon: Layers, unread: allPendingCount }]
      : []),
    { id: 'sent'     as TabId, label: 'Sent',     Icon: Send,  unread: sentUnreadCount },
    { id: 'received' as TabId, label: 'Received', Icon: Inbox, unread: receivedPendingCount },
  ]

  const activeList = activeTab === 'all' ? allList : activeTab === 'sent' ? sentList : receivedList
  const emptyCopy = searchActive
    ? `No applications match “${searchInput.trim()}”`
    : activeTab === 'all' ? 'No applications on record'
    : activeTab === 'sent' ? 'No applications sent yet'
    : 'No applications received yet'
  const EmptyIcon = activeTab === 'all' ? CalendarDays : activeTab === 'sent' ? Send : Inbox

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
            <form onSubmit={handleSubmit} className="rounded-[22px] bg-[#FAF9F6] border border-[#27272A]/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-[1.05rem] font-bold text-slate-900 headline">New OD / leave application</h2>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm() }}
                  aria-label="Close form"
                  className="lg-control w-8 h-8"
                >
                  <X size={15} />
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
                      ? <Avatar
                          avatarUrl={selectedRecipient.avatar_url}
                          name={selectedRecipient.full_name}
                          size={22}
                          userId={selectedRecipient.id}
                        />
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(['on_duty', 'casual', 'medical', 'half_day', 'late'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setLeaveType(t)
                        if ((t === 'half_day' || t === 'late') && startDate) setEndDate(startDate)
                      }}
                      className={`h-9 px-2 rounded-full text-xs sm:text-[13px] font-semibold border transition-all active:scale-[0.97] ${
                        leaveType === t
                          ? 'page-type-btn-active shadow-[0_4px_12px_-6px_rgba(124,58,237,0.6)]'
                          : 'text-slate-600 bg-white border-slate-200/80 hover:border-slate-300'
                      }`}
                    >
                      {LEAVE_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dates — a Half Day / Late Permit is a single day, so it only needs one field */}
              {leaveType === 'half_day' || leaveType === 'late' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Date <span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    value={startDate}
                    min={today}
                    onChange={e => { setStartDate(e.target.value); setEndDate(e.target.value) }}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none page-input-focus"
                  />
                </div>
              ) : (
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
              )}
              {leaveType === 'half_day' ? (
                startDate && <p className="text-xs page-accent-text font-medium -mt-1">Half day</p>
              ) : leaveType === 'late' ? (
                startDate && <p className="text-xs page-accent-text font-medium -mt-1">Late</p>
              ) : leaveDays !== null && (
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
                  className="h-10 px-4 rounded-full text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedRecipient || !startDate || !endDate || !reason.trim()}
                  className="h-10 px-5 rounded-full text-sm font-semibold text-white bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 shadow-[inset_0_1px_0_rgba(255,255,255,.2),0_8px_18px_-8px_rgba(124,58,237,0.7)] active:scale-[0.97] transition disabled:opacity-50 flex items-center gap-2"
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

      {/* ── Search: matches either side of an application, sender or receiver ── */}
      <div className="relative mb-2.5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search by sender or receiver name…"
          autoComplete="off"
          className="w-full h-10 pl-9 pr-9 text-sm bg-[#F4F2EE] border border-transparent rounded-full focus:outline-none focus:bg-white page-input-focus text-slate-700 placeholder:text-slate-400 transition"
        />
        {searching ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" />
        ) : searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Folder tabs ── */}
      {/* An iOS segmented control: a white thumb slides under the open folder. */}
      <div className="flex items-stretch gap-0.5 p-1 rounded-full bg-[#F1EEE8] mb-3 overflow-x-auto scrollbar-hide" role="tablist" aria-label="Folders">
        {tabs.map(({ id, label, Icon, unread }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(id)}
              className={`relative flex-1 flex items-center justify-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors ${
                active ? 'page-accent-text' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {active && (
                <motion.span
                  layoutId={embedded ? 'staff-leave-folder-embedded' : 'staff-leave-folder'}
                  className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_4px_12px_-4px_rgba(15,23,42,0.25)]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1.5">
                <Icon size={13} />
                <span>{label}</span>
                {unread > 0 && (
                  <span className={`min-w-[1.15rem] h-[1.15rem] px-1 rounded-full text-[10px] font-bold leading-[1.15rem] text-center tabular-nums ${
                    active ? 'bg-violet-600 text-white' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {unread}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className={listBleed}
        >
          {loading ? (
            <div className="text-center py-12">
              <div className="spinner mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading…</p>
            </div>
          ) : activeList.items.length === 0 ? (
            <EmptyState
              icon={EmptyIcon}
              text={emptyCopy}
              action={activeTab === 'sent' && !searchActive ? (
                <button
                  onClick={() => openNewApplication()}
                  className="text-sm page-text-link font-medium"
                >
                  Send a new application
                </button>
              ) : undefined}
            />
          ) : (
            <LeaveAppList
              list={activeList}
              userId={user.id}
              role={profile.role}
              // Both inbound folders can carry a decision the viewer owes — the
              // card still checks the approval is genuinely theirs. Sent never
              // does: nobody approves their own application.
              isApprover={activeTab !== 'sent'}
              canDelete={activeTab === 'all' && isPrincipalOrAdmin}
              variant="row"
              onRefresh={loadData}
              onLoadMore={() => loadMore(activeTab)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <LeaveApplicationDetailModal
        applicationId={detailAppId}
        currentUserId={user.id}
        currentUserRole={profile.role}
        canDelete={isPrincipalOrAdmin}
        onClose={closeDetail}
        onChanged={loadData}
        // Embedded, this has to clear the host popup, which ModalShell puts at
        // z-50 (not the z-40 this once assumed — at 45 it opened behind its
        // host). Matching z-50 rather than beating it keeps the card's own
        // review / attendance / delete popups — also z-50, but portalled later
        // — on top of this one, which is the order the card assumes.
        zClass={embedded ? 'z-50' : undefined}
      />
    </>
  )
})

export default StaffLeaveWorkspace
