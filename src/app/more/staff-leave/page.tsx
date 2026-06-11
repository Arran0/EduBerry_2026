'use client'

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarDays, Plus, Send, Inbox, X, Search,
  Paperclip, ImageIcon, File, AlertTriangle,
} from 'lucide-react'
import LeaveApplicationCard from '@/components/leave/LeaveApplicationCard'
import { STAFF_LEAVE_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  LeaveApplicationWithDetails,
  LeaveType,
  LEAVE_TYPE_LABELS,
  fetchMyLeaveApplications,
  fetchActiveApprovalsForStaff,
  fetchHistoryApprovalsForStaff,
  fetchAllLeaveApplications,
  searchLeaveRecipients,
  createStudentLeaveApplication,
  isImageFile,
  RecipientProfile,
} from '@/lib/leave'

type TabId = 'sent' | 'received'

const containerV = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
}
const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }

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

function AppList({
  apps, userId, role, isApprover, canDelete, onRefresh, highlightId,
}: {
  apps: LeaveApplicationWithDetails[]
  userId: string
  role: string
  isApprover: boolean
  canDelete?: boolean
  onRefresh: () => void
  highlightId?: string | null
}) {
  return (
    <motion.div variants={containerV} initial="hidden" animate="show" className="space-y-3">
      {apps.map(app => {
        const highlighted = highlightId === app.id
        return (
          <motion.div
            key={app.id}
            variants={itemV}
            id={`leave-app-${app.id}`}
            ref={highlighted ? (el => { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }) : undefined}
            className={highlighted ? 'rounded-2xl ring-2 ring-offset-2 transition-all' : ''}
            style={highlighted ? { '--tw-ring-color': 'var(--page-primary)' } as React.CSSProperties : undefined}
          >
            <LeaveApplicationCard
              application={app}
              currentUserId={userId}
              currentUserRole={role}
              isApprover={isApprover}
              canDelete={canDelete}
              onStatusChange={onRefresh}
            />
          </motion.div>
        )
      })}
    </motion.div>
  )
}

async function searchStaffRecipients(query: string): Promise<RecipientProfile[]> {
  const results = await searchLeaveRecipients(query)
  return results.filter(r => ['coordinator', 'principal', 'admin'].includes(r.role))
}

function StaffLeaveContent() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Deep-link params (from the attendance calendar)
  const deepLinkNew  = searchParams.get('new') === '1'
  const deepLinkDate = searchParams.get('date')
  const deepLinkApp  = searchParams.get('app')
  const [highlightId, setHighlightId] = useState<string | null>(deepLinkApp)
  const deepLinkHandled = useRef(false)

  const isAdmin            = profile?.role === 'admin'
  const isPrincipal        = profile?.role === 'principal'
  const isPrincipalOrAdmin = isAdmin || isPrincipal

  const [activeTab, setActiveTab]     = useState<TabId>('sent')
  const [showForm, setShowForm]       = useState(false)
  const [loading, setLoading]         = useState(true)

  const [sentApps, setSentApps]         = useState<LeaveApplicationWithDetails[]>([])
  const [receivedApps, setReceivedApps] = useState<LeaveApplicationWithDetails[]>([])
  const [allApps, setAllApps]           = useState<LeaveApplicationWithDetails[]>([])

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

  const loadData = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)

    const staffRoles = ['teacher', 'coordinator', 'principal', 'admin']
    const promises: Promise<unknown>[] = [
      fetchMyLeaveApplications(user.id).then(setSentApps),
      Promise.all([
        fetchActiveApprovalsForStaff(user.id),
        fetchHistoryApprovalsForStaff(user.id),
      ]).then(([active, history]) => {
        const seen = new Set<string>()
        const merged = [...active, ...history].filter(a => {
          if (seen.has(a.id)) return false
          seen.add(a.id)
          return true
        })
        setReceivedApps(merged.filter(a => staffRoles.includes(a.applicant?.role ?? '')))
      }),
    ]

    if (isPrincipalOrAdmin) {
      promises.push(fetchAllLeaveApplications().then(apps => setAllApps(apps.filter(a => a.applicant?.role !== 'student'))))
    }

    await Promise.all(promises)
    setLoading(false)
  }, [user, profile, isPrincipalOrAdmin])

  useEffect(() => { loadData() }, [loadData])

  // Deep-link: open a prefilled new application for a specific date
  useEffect(() => {
    if (deepLinkHandled.current) return
    if (deepLinkNew && deepLinkDate) {
      deepLinkHandled.current = true
      setShowForm(true)
      setStartDate(deepLinkDate)
      setEndDate(deepLinkDate)
      setActiveTab('sent')
    }
  }, [deepLinkNew, deepLinkDate])

  // Deep-link: highlight & scroll to a specific application once data is loaded
  useEffect(() => {
    if (!deepLinkApp || loading) return
    const inReceived = receivedApps.some(a => a.id === deepLinkApp)
    setActiveTab(inReceived ? 'received' : 'sent')
    setHighlightId(deepLinkApp)
    const t = setTimeout(() => setHighlightId(null), 4000)
    return () => clearTimeout(t)
  }, [deepLinkApp, loading, receivedApps])

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

  const resetForm = () => {
    setSelectedRecipient(null); setRecipientInput(''); setRecipientResults([])
    setLeaveType('on_duty'); setStartDate(''); setEndDate('')
    setReason(''); setAttachFile(null); setFormError('')
    if (fileRef.current) fileRef.current.value = ''
  }

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

  const receivedPendingCount = receivedApps.filter(a =>
    a.approvals?.some(ap => ap.approver_id === user.id && ap.status === 'pending')
  ).length

  const leaveDays = startDate && endDate && endDate >= startDate
    ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : null

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="staff-leave">
        <PageBanner
          settingKey="staff_leave_banner"
          defaultBanner={STAFF_LEAVE_BANNER_DEFAULT}
          icon={<CalendarDays size={26} className="text-white" />}
          title="Staff OD / Leave"
          subtitle="Apply for on duty or leave and manage applications"
          isAdmin={isAdmin}
          onBack={() => router.back()}
          maxWidth="max-w-3xl"
          actions={
            <>
              <button
                onClick={() => { resetForm(); setShowForm(v => !v) }}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-medium text-sm rounded-xl border border-white/30 transition-colors"
              >
                {showForm ? <X size={15} /> : <Plus size={15} />}
                {showForm ? 'Cancel' : 'New Application'}
              </button>
              <button
                onClick={() => { resetForm(); setShowForm(v => !v) }}
                className="sm:hidden w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center text-white transition-colors"
              >
                {showForm ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          }
        />
        <div className="relative z-0 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

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
        <div className="glass-strong rounded-2xl p-1.5 mb-5 flex gap-1">
          {([
            { id: 'sent'     as TabId, label: 'Sent',     Icon: Send,  count: sentApps.length,     badge: 0 },
            { id: 'received' as TabId, label: 'Received', Icon: Inbox, count: receivedApps.length, badge: receivedPendingCount },
          ]).map(({ id, label, Icon, count, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all ${
                activeTab === id
                  ? 'page-tab-active'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={14} />
              {label}
              {count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  activeTab === id ? 'bg-white/25' : 'bg-slate-200 text-slate-600'
                }`}>
                  {count}
                </span>
              )}
              {badge > 0 && activeTab !== id && (
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              )}
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
              sentApps.length === 0 ? (
                <EmptyState
                  icon={Send}
                  text="No applications sent yet"
                  action={
                    <button
                      onClick={() => { resetForm(); setShowForm(true) }}
                      className="text-sm page-text-link font-medium"
                    >
                      Send a new application
                    </button>
                  }
                />
              ) : (
                <AppList
                  apps={sentApps}
                  userId={user.id}
                  role={profile.role}
                  isApprover={false}
                  onRefresh={loadData}
                  highlightId={highlightId}
                />
              )
            ) : (
              receivedApps.length === 0 ? (
                <EmptyState icon={Inbox} text="No applications received yet" />
              ) : (
                <AppList
                  apps={receivedApps}
                  userId={user.id}
                  role={profile.role}
                  isApprover={true}
                  onRefresh={loadData}
                  highlightId={highlightId}
                />
              )
            )}
          </motion.div>
        </AnimatePresence>

        {/* ── Principal / Admin: All Staff Applications ── */}
        {isPrincipalOrAdmin && !loading && (
          <div className="mt-10 pt-8 border-t border-slate-200">
            <h2 className="font-bold text-slate-800 mb-4">All Staff Applications</h2>
            {allApps.length === 0 ? (
              <EmptyState icon={CalendarDays} text="No applications on record" />
            ) : (
              <AppList
                apps={allApps}
                userId={user.id}
                role={profile.role}
                isApprover={true}
                canDelete={true}
                onRefresh={loadData}
                highlightId={highlightId}
              />
            )}
          </div>
        )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

export default function StaffLeavePage() {
  return (
    <Suspense fallback={
      <ProtectedLayout staffOnly>
        <div className="text-center py-20">
          <div className="spinner mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </ProtectedLayout>
    }>
      <StaffLeaveContent />
    </Suspense>
  )
}
