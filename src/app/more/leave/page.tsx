'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import {
  CalendarDays, Plus, Clock, History, Search, X, ChevronDown,
  Paperclip, ImageIcon, File, AlertTriangle, ArrowLeft,
} from 'lucide-react'
import LeaveApplicationCard from '@/components/leave/LeaveApplicationCard'
import LeaveStatsCard from '@/components/leave/LeaveStatsCard'
import Link from 'next/link'
import {
  LeaveApplicationWithDetails,
  LeaveStats,
  LEAVE_TYPE_LABELS,
  fetchMyLeaveApplications,
  fetchLeaveStats,
  fetchAllLeaveApplications,
  fetchActiveApprovalsForStaff,
  fetchHistoryApprovalsForStaff,
  searchLeaveRecipients,
  createStudentLeaveApplication,
  isImageFile,
  RecipientProfile,
} from '@/lib/leave'

type TabId = 'active' | 'history'

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

export default function LeavePage() {
  const { user, profile } = useAuth()
  const isStudent = profile?.role === 'student'
  const isPrincipalOrAdmin = profile?.role === 'principal' || profile?.role === 'admin'
  const isStaff = !isStudent

  const [activeTab, setActiveTab] = useState<TabId>('active')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  // Student state
  const [myApps, setMyApps] = useState<LeaveApplicationWithDetails[]>([])
  const [stats, setStats] = useState<LeaveStats>({ applied: 0, approved: 0, pending: 0, rejected: 0 })

  // Staff state
  const [staffActive, setStaffActive] = useState<LeaveApplicationWithDetails[]>([])
  const [staffHistory, setStaffHistory] = useState<LeaveApplicationWithDetails[]>([])

  // Principal/Admin – all apps overview
  const [allApps, setAllApps] = useState<LeaveApplicationWithDetails[]>([])
  const [allTab, setAllTab] = useState<'active' | 'all'>('active')

  // Form
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipientResults, setRecipientResults] = useState<RecipientProfile[]>([])
  const [selectedRecipient, setSelectedRecipient] = useState<RecipientProfile | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [leaveType, setLeaveType] = useState<'casual' | 'medical'>('casual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [attachFile, setAttachFile] = useState<File | null>(null)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  const loadData = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    if (isStudent) {
      const [apps, s] = await Promise.all([
        fetchMyLeaveApplications(user.id),
        fetchLeaveStats(user.id),
      ])
      setMyApps(apps)
      setStats(s)
    } else {
      const promises: Promise<unknown>[] = [
        fetchActiveApprovalsForStaff(user.id).then(setStaffActive),
        fetchHistoryApprovalsForStaff(user.id).then(setStaffHistory),
      ]
      if (isPrincipalOrAdmin) {
        promises.push(fetchAllLeaveApplications().then(setAllApps))
      }
      await Promise.all(promises)
    }
    setLoading(false)
  }, [user, profile, isStudent, isPrincipalOrAdmin])

  useEffect(() => { loadData() }, [loadData])

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

  const resetForm = () => {
    setSelectedRecipient(null); setRecipientQuery(''); setRecipientResults([])
    setLeaveType('casual'); setStartDate(''); setEndDate('')
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
    const result = await createStudentLeaveApplication(
      { leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason.trim() },
      user.id, selectedRecipient.id, selectedRecipient.role,
      attachFile ?? undefined,
    )
    setSubmitting(false)
    if (result) { resetForm(); setShowForm(false); await loadData(); setActiveTab('active') }
    else setFormError('Failed to submit. Please try again.')
  }

  if (!user || !profile) return null

  const activeMyApps = myApps.filter(a => a.status === 'pending')
  const historyMyApps = myApps.filter(a => a.status !== 'pending')

  const allActiveApps = allApps.filter(a => a.status === 'pending')

  // ── HEADER shared ───────────────────────────────────────────
  const header = (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-gradient-to-br from-rose-400 to-pink-500 rounded-xl shadow-lg">
          <CalendarDays className="text-white" size={22} />
        </div>
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-800">
            {isStudent ? 'My Leave' : 'Leave Requests'}
          </h1>
          <p className="text-slate-500 text-sm">
            {isStudent ? 'Apply and track your leave applications' : 'Review and manage leave applications'}
          </p>
        </div>
      </div>
      {isStudent && (
        <button
          onClick={() => { resetForm(); setShowForm(v => !v) }}
          className="btn-primary flex items-center gap-2 text-sm flex-shrink-0"
        >
          {showForm ? <X size={15} /> : <Plus size={15} />}
          <span className="hidden sm:inline">{showForm ? 'Cancel' : 'New Application'}</span>
          <span className="sm:hidden">{showForm ? 'Cancel' : 'Apply'}</span>
        </button>
      )}
    </div>
  )

  const tabs = (active: number, history: number, color = 'from-rose-400 to-pink-500') => (
    <div className="glass rounded-2xl p-1.5 mb-5 flex gap-1">
      {([
        { id: 'active' as TabId, label: 'Active', Icon: Clock, count: active },
        { id: 'history' as TabId, label: 'History', Icon: History, count: history },
      ]).map(({ id, label, Icon, count }) => (
        <button
          key={id}
          onClick={() => setActiveTab(id)}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all ${
            activeTab === id
              ? `bg-gradient-to-r ${color} text-white shadow-md`
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
  )

  // ── STUDENT VIEW ────────────────────────────────────────────
  if (isStudent) {
    return (
      <ProtectedLayout>
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-page-theme="more">
          {header}

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
                      Send To <span className="text-slate-400 font-normal">– Teacher / Coordinator / Principal / Admin</span>
                    </label>
                    <div ref={searchRef} className="relative">
                      <div className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 bg-white transition-colors ${
                        selectedRecipient ? 'border-blue-300' : 'border-slate-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-400/20'
                      }`}>
                        {selectedRecipient ? <Avatar avatarUrl={selectedRecipient.avatar_url} name={selectedRecipient.full_name} size={22} /> : <Search size={14} className="text-slate-400 flex-shrink-0" />}
                        <input
                          type="text"
                          value={recipientQuery}
                          onChange={e => { setRecipientQuery(e.target.value); if (selectedRecipient) setSelectedRecipient(null) }}
                          placeholder="Search by name or email…"
                          className="flex-1 bg-transparent text-sm focus:outline-none text-slate-700 placeholder:text-slate-400"
                          autoComplete="off"
                        />
                        {searchLoading && <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
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

                  {/* Reason + attachment */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Reason <span className="text-red-500">*</span></label>
                    <textarea value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Briefly describe your reason for leave…"
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400/40 resize-none" />

                    {/* Attachment */}
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

          {tabs(activeMyApps.length, historyMyApps.length)}

          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              {loading ? (
                <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
              ) : activeTab === 'active' ? (
                activeMyApps.length === 0
                  ? <EmptyState icon={CalendarDays} text="No pending applications"
                      action={<button onClick={() => { resetForm(); setShowForm(true) }} className="text-sm text-rose-500 hover:text-rose-600 font-medium">Apply for leave</button>} />
                  : <AppList apps={activeMyApps} userId={user.id} role={profile.role} isApprover={false} onRefresh={loadData} />
              ) : (
                historyMyApps.length === 0
                  ? <EmptyState icon={History} text="No leave history yet" />
                  : <AppList apps={historyMyApps} userId={user.id} role={profile.role} isApprover={false} onRefresh={loadData} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </ProtectedLayout>
    )
  }

  // ── STAFF / ADMIN VIEW ──────────────────────────────────────
  return (
    <ProtectedLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-page-theme="more">
        {header}

        {tabs(staffActive.length, staffHistory.length)}

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            {loading ? (
              <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
            ) : activeTab === 'active' ? (
              staffActive.length === 0
                ? <EmptyState icon={Clock} text="No pending applications to review" />
                : <AppList apps={staffActive} userId={user.id} role={profile.role} isApprover={true} onRefresh={loadData} />
            ) : (
              staffHistory.length === 0
                ? <EmptyState icon={History} text="No reviewed applications yet" />
                : <AppList apps={staffHistory} userId={user.id} role={profile.role} isApprover={false} onRefresh={loadData} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* ── PRINCIPAL / ADMIN: All Applications overview ── */}
        {isPrincipalOrAdmin && (
          <div className="mt-10 pt-8 border-t border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-slate-800">All Student Applications</h2>
                <p className="text-xs text-slate-500 mt-0.5">Every leave application submitted across the school</p>
              </div>
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                {(['active', 'all'] as const).map(t => (
                  <button key={t} onClick={() => setAllTab(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${allTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {t === 'active' ? `Active (${allActiveApps.length})` : `All (${allApps.length})`}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="text-center py-8"><div className="spinner mx-auto mb-3" /></div>
            ) : (() => {
              const list = allTab === 'active' ? allActiveApps : allApps
              return list.length === 0
                ? <EmptyState icon={CalendarDays} text={allTab === 'active' ? 'No active applications' : 'No applications yet'} />
                : <AppList apps={list} userId={user.id} role={profile.role} isApprover={allTab === 'active'} canDelete={true} onRefresh={loadData} />
            })()}
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
