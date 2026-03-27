'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import {
  CalendarDays, Plus, Clock, History, Database,
  CheckCircle, Search, X, Paperclip, File, ImageIcon,
  AlertTriangle,
} from 'lucide-react'
import LeaveApplicationCard from '@/components/leave/LeaveApplicationCard'
import LeaveBalanceCard from '@/components/leave/LeaveBalanceCard'
import {
  LeaveApplicationWithDetails,
  fetchMyLeaveApplications,
  fetchPendingApprovalsForUser,
  fetchLeaveBalance,
  fetchAllLeaveApplications,
  searchStaffRecipients,
  createStudentLeaveApplication,
  LEAVE_TYPE_LABELS,
  LeaveType,
  NewLeaveInput,
  RecipientProfile,
  isImageFile,
} from '@/lib/leave'

type TabId = 'mine' | 'review' | 'history' | 'all'
type AllSubTab = 'pending' | 'all'

const containerV = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }
const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }

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
    <div className="glass rounded-2xl p-10 text-center">
      <Icon size={36} className="text-slate-200 mx-auto mb-3" />
      <p className="text-slate-500 text-sm">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function AppList({ apps, userId, role, isApprover, canDelete, onRefresh }: {
  apps: LeaveApplicationWithDetails[]
  userId: string
  role: string
  isApprover: boolean
  canDelete?: boolean
  onRefresh: () => void
}) {
  return (
    <motion.div variants={containerV} initial="hidden" animate="show" className="space-y-3">
      {apps.map(app => (
        <motion.div key={app.id} variants={itemV}>
          <LeaveApplicationCard
            application={app}
            currentUserId={userId}
            currentUserRole={role}
            isApprover={isApprover}
            canDelete={canDelete}
            onStatusChange={onRefresh}
          />
        </motion.div>
      ))}
    </motion.div>
  )
}

export default function StaffLeavePage() {
  const { user, profile } = useAuth()

  const isAdmin     = profile?.role === 'admin'
  const isPrincipal = profile?.role === 'principal'
  const canApply    = !isAdmin
  const canReview   = profile?.role ? ['teacher', 'coordinator', 'principal', 'admin'].includes(profile.role) : false
  const showAll     = isAdmin || isPrincipal

  const defaultTab: TabId = isAdmin ? 'review' : 'mine'
  const [activeTab, setActiveTab]           = useState<TabId>(defaultTab)
  const [allSubTab, setAllSubTab]           = useState<AllSubTab>('pending')
  const [showForm, setShowForm]             = useState(false)
  const [loading, setLoading]               = useState(true)

  const [myApplications, setMyApplications]     = useState<LeaveApplicationWithDetails[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<LeaveApplicationWithDetails[]>([])
  const [allApplications, setAllApplications]   = useState<LeaveApplicationWithDetails[]>([])
  const [balance, setBalance] = useState({ casual: { used: 0, total: 12 }, medical: { used: 0, total: 15 } })

  // ── Form state ──
  const [recipient,        setRecipient]        = useState<RecipientProfile | null>(null)
  const [recipientQuery,   setRecipientQuery]   = useState('')
  const [recipientResults, setRecipientResults] = useState<RecipientProfile[]>([])
  const [searchLoading,    setSearchLoading]    = useState(false)
  const [leaveType,        setLeaveType]        = useState<LeaveType>('casual')
  const [startDate,        setStartDate]        = useState('')
  const [endDate,          setEndDate]          = useState('')
  const [reason,           setReason]           = useState('')
  const [attachFile,       setAttachFile]       = useState<File | null>(null)
  const [formError,        setFormError]        = useState('')
  const [submitting,       setSubmitting]       = useState(false)

  const searchRef   = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileRef     = useRef<HTMLInputElement>(null)
  const today       = new Date().toISOString().split('T')[0]

  const loadData = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    try {
      const promises: Promise<unknown>[] = []
      if (!isAdmin) {
        promises.push(
          fetchMyLeaveApplications(user.id).then(setMyApplications),
          fetchLeaveBalance(user.id).then(setBalance),
        )
      }
      if (canReview) {
        promises.push(fetchPendingApprovalsForUser(user.id, profile.role).then(setPendingApprovals))
      }
      if (showAll) {
        promises.push(fetchAllLeaveApplications().then(setAllApplications))
      }
      await Promise.all(promises)
    } catch (err) {
      console.error('Failed to load leave data:', err)
    }
    setLoading(false)
  }, [user, profile, isAdmin, canReview, showAll])

  useEffect(() => { loadData() }, [loadData])

  // Recipient search debounce
  useEffect(() => {
    if (recipient) { setRecipientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (recipientQuery.trim().length < 2) { setRecipientResults([]); return }
    searchTimer.current = setTimeout(async () => {
      if (!profile) return
      setSearchLoading(true)
      setRecipientResults(await searchStaffRecipients(recipientQuery, profile.role))
      setSearchLoading(false)
    }, 280)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [recipientQuery, recipient, profile])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setRecipientResults([])
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const resetForm = () => {
    setRecipient(null); setRecipientQuery(''); setRecipientResults([])
    setLeaveType('casual'); setStartDate(''); setEndDate('')
    setReason(''); setAttachFile(null); setFormError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!recipient) { setFormError('Please select who to send this to.'); return }
    if (!startDate || !endDate) { setFormError('Please select start and end dates.'); return }
    if (endDate < startDate) { setFormError('End date must be on or after start date.'); return }
    if (!reason.trim()) { setFormError('Please provide a reason.'); return }

    setSubmitting(true); setFormError('')
    const result = await createStudentLeaveApplication(
      { leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason.trim() },
      user.id, recipient.id, recipient.role,
      attachFile ?? undefined,
    )
    setSubmitting(false)
    if (result) { resetForm(); setShowForm(false); await loadData(); setActiveTab('mine') }
    else setFormError('Failed to submit. Please try again.')
  }

  if (!user || !profile) return null

  const myPending  = myApplications.filter(a => a.status === 'pending')
  const myHistory  = myApplications.filter(a => a.status !== 'pending')
  const allPending = allApplications.filter(a => a.status === 'pending')

  // Build tab list
  const tabList: { id: TabId; label: string; Icon: React.ElementType; count: number }[] = []
  if (!isAdmin)  tabList.push({ id: 'mine',    label: 'Pending',  Icon: CalendarDays, count: myPending.length })
  if (canReview) tabList.push({ id: 'review',  label: 'Review',   Icon: Clock,        count: pendingApprovals.length })
  if (!isAdmin)  tabList.push({ id: 'history', label: 'Reviewed', Icon: History,      count: myHistory.length })
  if (showAll)   tabList.push({ id: 'all',     label: 'All',      Icon: Database,     count: allApplications.length })

  return (
    <ProtectedLayout staffOnly>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-page-theme="more">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-rose-400 to-pink-500 rounded-xl shadow-lg">
              <CalendarDays className="text-white" size={22} />
            </div>
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-800">
                {isAdmin ? 'Leave Records' : 'Staff Leave'}
              </h1>
              <p className="text-slate-500 text-sm">
                {isAdmin ? 'Review and manage all staff leave applications' : 'Apply and track your leave applications'}
              </p>
            </div>
          </div>
          {canApply && (
            <button
              onClick={() => { resetForm(); setShowForm(v => !v) }}
              className="btn-primary flex items-center gap-2 text-sm !py-1.5 flex-shrink-0"
            >
              {showForm ? <X size={15} /> : <Plus size={15} />}
              <span className="hidden sm:inline">{showForm ? 'Cancel' : 'New Application'}</span>
              <span className="sm:hidden">{showForm ? 'Cancel' : 'Apply'}</span>
            </button>
          )}
        </div>

        {/* Leave balance */}
        {!isAdmin && (
          <div className="mb-5">
            <LeaveBalanceCard casual={balance.casual} medical={balance.medical} />
          </div>
        )}

        {/* Inline application form */}
        <AnimatePresence>
          {showForm && canApply && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-5 overflow-hidden"
            >
              <form onSubmit={handleSubmit} className="glass rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-slate-800">New Leave Application</h2>
                  <button type="button" onClick={() => { setShowForm(false); resetForm() }} className="p-1 text-slate-400 hover:text-slate-600">
                    <X size={18} />
                  </button>
                </div>

                {/* Recipient search */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Send To <span className="text-slate-400 font-normal">
                      {profile.role === 'teacher'     ? '– Coordinator / Principal / Admin' :
                       profile.role === 'coordinator' ? '– Principal / Admin' :
                       profile.role === 'principal'   ? '– Admin' : ''}
                    </span>
                  </label>
                  <div ref={searchRef} className="relative">
                    <div className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 bg-white transition-colors ${
                      recipient ? 'border-rose-300' : 'border-slate-200 focus-within:border-rose-400 focus-within:ring-2 focus-within:ring-rose-400/20'
                    }`}>
                      {recipient ? <Avatar avatarUrl={recipient.avatar_url} name={recipient.full_name} size={22} /> : <Search size={14} className="text-slate-400 flex-shrink-0" />}
                      <input
                        type="text"
                        value={recipientQuery}
                        onChange={e => { setRecipientQuery(e.target.value); if (recipient) setRecipient(null) }}
                        placeholder="Search by name or email…"
                        className="flex-1 bg-transparent text-sm focus:outline-none text-slate-700 placeholder:text-slate-400"
                        autoComplete="off"
                      />
                      {searchLoading && <div className="w-3.5 h-3.5 border-2 border-rose-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                      {recipient && (
                        <button type="button" onClick={() => { setRecipient(null); setRecipientQuery('') }} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    {recipient && (
                      <div className="mt-1.5 flex items-center gap-2 px-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOR[recipient.role] ?? 'bg-slate-100 text-slate-600'}`}>
                          {ROLE_LABEL[recipient.role] ?? recipient.role}
                        </span>
                        <span className="text-xs text-slate-700 font-medium">{recipient.full_name}</span>
                      </div>
                    )}

                    <AnimatePresence>
                      {recipientResults.length > 0 && !recipient && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                          className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-lg z-20 overflow-hidden"
                        >
                          {recipientResults.map(r => (
                            <button key={r.id} type="button" onClick={() => { setRecipient(r); setRecipientQuery(r.full_name); setRecipientResults([]) }}
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
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Leave Type</label>
                  <div className="flex gap-2">
                    {(['casual', 'medical'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setLeaveType(t)}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                          leaveType === t ? 'bg-rose-500 text-white border-rose-500' : 'text-slate-600 border-slate-200 hover:bg-slate-50'
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
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400/40" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">To <span className="text-red-500">*</span></label>
                    <input type="date" value={endDate} min={startDate || today}
                      onChange={e => setEndDate(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400/40" />
                  </div>
                </div>

                {startDate && endDate && endDate >= startDate && (
                  <p className="text-xs text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg">
                    Duration: {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1} day(s)
                  </p>
                )}

                {/* Reason + attachment */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Reason <span className="text-red-500">*</span></label>
                  <textarea value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Briefly describe your reason for leave…"
                    rows={3}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400/40 resize-none" />

                  <div className="mt-2">
                    {!attachFile ? (
                      <button type="button" onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-xl text-xs text-slate-500 hover:border-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors w-full">
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
                  <button type="submit" disabled={submitting || !recipient || !startDate || !endDate || !reason.trim()}
                    className="btn-primary text-sm px-5 py-2 disabled:opacity-50 flex items-center gap-2">
                    {submitting && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    {submitting ? 'Submitting…' : 'Submit Application'}
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tabs — same style as student leave */}
        <div className="glass rounded-2xl p-1.5 mb-5 flex gap-1">
          {tabList.map(({ id, label, Icon, count }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all ${
                activeTab === id
                  ? 'bg-gradient-to-r from-rose-400 to-pink-500 text-white shadow-md'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={14} />
              {label}
              {count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${activeTab === id ? 'bg-white/25' : 'bg-slate-200 text-slate-600'}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            {loading ? (
              <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
            ) : activeTab === 'mine' ? (
              myPending.length === 0
                ? <EmptyState icon={CalendarDays} text="No pending applications"
                    action={<button onClick={() => { resetForm(); setShowForm(true) }} className="text-sm text-rose-500 hover:text-rose-600 font-medium">Apply for leave</button>} />
                : <AppList apps={myPending} userId={user.id} role={profile.role} isApprover={false} onRefresh={loadData} />
            ) : activeTab === 'review' ? (
              pendingApprovals.length === 0
                ? <EmptyState icon={CheckCircle} text="No pending approvals" />
                : <AppList apps={pendingApprovals} userId={user.id} role={profile.role} isApprover={true} onRefresh={loadData} />
            ) : activeTab === 'history' ? (
              myHistory.length === 0
                ? <EmptyState icon={History} text="No reviewed applications yet" />
                : <AppList apps={myHistory} userId={user.id} role={profile.role} isApprover={false} onRefresh={loadData} />
            ) : (
              /* All Records */
              <div className="space-y-4">
                <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
                  {(['pending', 'all'] as AllSubTab[]).map(t => (
                    <button key={t} onClick={() => setAllSubTab(t)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        allSubTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}>
                      {t === 'pending' ? `Pending (${allPending.length})` : `All (${allApplications.length})`}
                    </button>
                  ))}
                </div>
                {(() => {
                  const list = allSubTab === 'pending' ? allPending : allApplications
                  return list.length === 0
                    ? <EmptyState icon={Database} text={allSubTab === 'pending' ? 'No pending applications' : 'No applications on record'} />
                    : <AppList apps={list} userId={user.id} role={profile.role} isApprover={allSubTab === 'pending'} canDelete={true} onRefresh={loadData} />
                })()}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

      </div>
    </ProtectedLayout>
  )
}
