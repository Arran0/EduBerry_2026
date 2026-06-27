'use client'

import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  MessageSquare,
  Paperclip,
  ImageIcon,
  FileText,
  File,
  X,
  Trash2,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  LeaveApplicationWithDetails,
  LeaveApproval,
  processLeaveApproval,
  deleteLeaveApplication,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_COLORS,
  isImageFile,
} from '@/lib/leave'
import { Homeroom, fetchHomeromsForStudent } from '@/lib/homerooms'
import { isStaffRole } from '@/lib/supabase'

const AttendanceCalendarDynamic = dynamic(
  () => import('@/components/attendance/AttendanceCalendar'),
  { ssr: false, loading: () => <CalendarLoadingFallback /> }
)
const StaffAttendanceCalendarDynamic = dynamic(
  () => import('@/components/attendance/StaffAttendanceCalendar'),
  { ssr: false, loading: () => <CalendarLoadingFallback /> }
)

function CalendarLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
      Loading calendar…
    </div>
  )
}

interface LeaveApplicationCardProps {
  application: LeaveApplicationWithDetails
  currentUserId: string
  currentUserRole: string
  isApprover?: boolean
  canDelete?: boolean
  onStatusChange?: () => void
}

const TYPE_STYLE = {
  casual:  { accentFrom: 'from-blue-400',   iconBg: 'bg-blue-50',   iconColor: 'text-blue-500',   pill: 'bg-blue-50 text-blue-600' },
  on_duty: { accentFrom: 'from-teal-400',   iconBg: 'bg-teal-50',   iconColor: 'text-teal-500',   pill: 'bg-teal-50 text-teal-600' },
  medical: { accentFrom: 'from-purple-400', iconBg: 'bg-purple-50', iconColor: 'text-purple-500', pill: 'bg-purple-50 text-purple-600' },
} as const

function formatShortDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return start === end ? fmt(s) : `${fmt(s)} – ${fmt(e)}`
}

function formatSubmittedAt(d: string): string {
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDecidedAt(d: string): string {
  const date = new Date(d)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (sameDay) return time
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

function calcDays(start: string, end: string): number {
  return Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
}

function AttachmentView({ url, name }: { url: string; name: string }) {
  const isImg = isImageFile(name)
  const [open, setOpen] = useState(isImg)

  if (isImg) {
    return (
      <div className="space-y-1">
        <button
          onClick={() => setOpen(p => !p)}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ImageIcon size={11} />
          <span className="truncate max-w-[140px]">{name}</span>
          <span className="ml-0.5">{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img
              src={url}
              alt={name}
              className="rounded-xl max-h-44 max-w-full object-contain border border-slate-100 hover:opacity-90 transition-opacity"
            />
          </a>
        )}
      </div>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors"
    >
      <FileText size={11} />
      <span className="truncate max-w-[180px]">{name}</span>
    </a>
  )
}

function FilePickerButton({
  file, onFile, onClear,
}: { file: File | null; onFile: (f: File) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const isImg = file ? isImageFile(file.name) : false

  return (
    <div className="space-y-2">
      {!file ? (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-xl text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors w-full"
        >
          <Paperclip size={13} />
          Attach image or document (optional)
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
            {isImg
              ? <ImageIcon size={13} className="text-blue-500 flex-shrink-0" />
              : <File size={13} className="text-slate-400 flex-shrink-0" />}
            <span className="text-xs text-slate-700 flex-1 min-w-0 truncate">{file.name}</span>
            <button type="button" onClick={onClear} className="text-slate-400 hover:text-red-500 flex-shrink-0">
              <X size={13} />
            </button>
          </div>
          {isImg && (
            <img
              src={URL.createObjectURL(file)}
              alt={file.name}
              className="rounded-xl max-h-40 max-w-full object-contain border border-slate-100"
            />
          )}
        </div>
      )}
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept="image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </div>
  )
}

export default function LeaveApplicationCard({
  application,
  currentUserId,
  currentUserRole,
  isApprover = false,
  canDelete = false,
  onStatusChange,
}: LeaveApplicationCardProps) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [selectedApproval, setSelectedApproval] = useState<LeaveApproval | null>(null)
  const [comments, setComments] = useState('')
  const [decisionFile, setDecisionFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const days = calcDays(application.start_date, application.end_date)
  const ts = TYPE_STYLE[application.leave_type]
  const isOwnApplication = application.applicant_id === currentUserId
  const isApplicantStaff = application.applicant ? isStaffRole(application.applicant.role as any) : false

  // Attendance popup state
  const [showAttModal, setShowAttModal] = useState(false)
  const [attHomerooms, setAttHomerooms] = useState<Homeroom[]>([])
  const [attHomeroomId, setAttHomeroomId] = useState<string | null>(null)
  const [attYear, setAttYear] = useState(() => new Date().getFullYear())
  const [attMonth, setAttMonth] = useState(() => new Date().getMonth() + 1)
  const [loadingAttHomerooms, setLoadingAttHomerooms] = useState(false)

  const handleOpenAttModal = async () => {
    setShowAttModal(true)
    if (!isApplicantStaff && attHomerooms.length === 0) {
      setLoadingAttHomerooms(true)
      const rooms = await fetchHomeromsForStudent(application.applicant_id)
      setAttHomerooms(rooms)
      if (rooms.length > 0) setAttHomeroomId(rooms[0].id)
      setLoadingAttHomerooms(false)
    }
  }

  const myPendingApprovals = application.approvals.filter(a => {
    if (a.status !== 'pending') return false
    if (a.approver_id === currentUserId) return true
    if (currentUserRole === 'coordinator' && a.approver_role === 'coordinator' && !a.approver_id) return true
    if (currentUserRole === 'principal'   && a.approver_role === 'principal'   && !a.approver_id) return true
    if (currentUserRole === 'admin'       && a.approver_role === 'admin'       && !a.approver_id) return true
    return false
  })

  const openModal = (approval: LeaveApproval) => {
    setSelectedApproval(approval)
    setComments('')
    setDecisionFile(null)
    setShowModal(true)
  }

  const handleDecision = async (decision: 'approved' | 'rejected') => {
    if (!selectedApproval) return
    setProcessing(true)
    const ok = await processLeaveApproval(
      selectedApproval.id, currentUserId, decision, comments, decisionFile ?? undefined
    )
    setProcessing(false)
    setShowModal(false)
    setSelectedApproval(null)
    if (ok && onStatusChange) onStatusChange()
  }

  const handleDelete = async () => {
    setDeleting(true)
    const ok = await deleteLeaveApplication(application.id)
    setDeleting(false)
    setShowDeleteConfirm(false)
    if (ok && onStatusChange) onStatusChange()
  }

  return (
    <>
      <div className="glass-strong rounded-2xl overflow-hidden">
        {/* Type accent bar */}
        <div className={`h-[3px] bg-gradient-to-r ${ts.accentFrom} to-transparent`} />

        <div className="p-3.5 space-y-2.5">
          {/* Row 1: Applicant name (clickable → attendance popup) + submission time */}
          <div className="flex items-center gap-2">
            <Avatar
              avatarUrl={application.applicant?.avatar_url ?? null}
              name={application.applicant?.full_name ?? ''}
              size={26}
              userId={application.applicant_id}
            />
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={handleOpenAttModal}
                className="text-sm font-semibold text-slate-800 truncate leading-tight hover:text-blue-600 hover:underline transition-colors text-left w-full block"
              >
                {application.applicant?.full_name ?? '—'}
              </button>
              <p className="text-[11px] text-slate-500 capitalize leading-tight">
                {application.applicant?.role ?? ''}
                {application.applicant?.grade ? ` · Gr ${application.applicant.grade}` : ''}
                {application.applicant?.section ? ` ${application.applicant.section}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[11px] text-slate-400">{formatSubmittedAt(application.created_at)}</span>
              {canDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete application"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Leave type + date range + status */}
          <div className="flex items-center gap-2">
            <div className={`flex-shrink-0 p-1.5 rounded-lg ${ts.iconBg}`}>
              <Calendar size={13} className={ts.iconColor} />
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
              <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-500 leading-tight">
                {LEAVE_TYPE_LABELS[application.leave_type]}
              </h3>
              <span className="text-slate-300 text-xs">·</span>
              <span className="text-xs text-slate-700 font-medium">
                {formatShortDateRange(application.start_date, application.end_date)}
              </span>
              <span className={`px-1.5 py-px rounded-full text-[10px] font-semibold ${ts.pill}`}>
                {days}d
              </span>
            </div>
            <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium border ${LEAVE_STATUS_COLORS[application.status]}`}>
              {LEAVE_STATUS_LABELS[application.status]}
            </span>
          </div>

          {/* Reason */}
          <p className="text-sm text-slate-600 leading-relaxed">{application.reason}</p>

          {/* Application attachment */}
          {application.attachment_url && application.attachment_name && (
            <AttachmentView url={application.attachment_url} name={application.attachment_name} />
          )}

          {/* Approval trail */}
          {application.approvals.length > 0 && (
            <div className="border-t border-slate-100 pt-2 space-y-1.5">
              {application.approvals.map(a => (
                <div key={a.id} className="flex items-start gap-1.5">
                  <div className="flex-shrink-0 mt-px">
                    {a.status === 'approved' && <CheckCircle size={11} className="text-green-500" />}
                    {a.status === 'rejected' && <XCircle size={11} className="text-red-500" />}
                    {a.status === 'pending'  && <Clock size={11} className="text-amber-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {a.approver && (
                          <Avatar
                            avatarUrl={a.approver.avatar_url ?? null}
                            name={a.approver.full_name}
                            size={14}
                            userId={a.approver_id ?? undefined}
                          />
                        )}
                        <span className="text-xs font-medium text-slate-700 truncate">
                          {a.approver?.full_name ?? a.approver_role}
                        </span>
                      </div>
                      <div className="flex flex-col items-end flex-shrink-0">
                        <span className={`text-[11px] font-semibold ${
                          a.status === 'approved' ? 'text-green-600'
                          : a.status === 'rejected' ? 'text-red-600'
                          : 'text-amber-500'
                        }`}>
                          {LEAVE_STATUS_LABELS[a.status]}
                        </span>
                        {a.decided_at && a.status !== 'pending' && (
                          <span className="text-[9px] text-slate-400 leading-tight">
                            {formatDecidedAt(a.decided_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    {a.comments && (
                      <p className="text-xs text-slate-500 italic mt-0.5 leading-relaxed">
                        &ldquo;{a.comments}&rdquo;
                      </p>
                    )}
                    {a.attachment_url && a.attachment_name && (
                      <div className="mt-1">
                        <AttachmentView url={a.attachment_url} name={a.attachment_name} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Approver actions */}
          {isApprover && myPendingApprovals.length > 0 && (
            <div className="pt-1.5 border-t border-slate-100 space-y-2">
              {myPendingApprovals.map(a => (
                <button
                  key={a.id}
                  onClick={() => openModal(a)}
                  className="w-full btn-primary text-sm flex items-center justify-center gap-2"
                >
                  Review & Decide
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showDeleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowDeleteConfirm(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-red-100 rounded-xl">
                    <Trash2 size={18} className="text-red-600" />
                  </div>
                  <h3 className="font-bold text-slate-800">Delete Application?</h3>
                </div>
                <p className="text-sm text-slate-600 mb-5">
                  This will permanently delete the leave application
                  {application.applicant ? ` from ${application.applicant.full_name}` : ''}. This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl font-medium text-sm hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl font-medium text-sm hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {deleting && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Decision modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showModal && selectedApproval && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                {/* Sticky header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
                  <h3 className="text-lg font-bold text-slate-800">Review Leave Application</h3>
                  <button onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                    <X size={18} />
                  </button>
                </div>

                {/* Scrollable content */}
                <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
                  {/* Applicant summary */}
                  <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 text-sm">
                    {application.applicant && (
                      <div className="flex items-center gap-2">
                        <Avatar
                          avatarUrl={application.applicant.avatar_url}
                          name={application.applicant.full_name}
                          size={24}
                          userId={application.applicant_id}
                        />
                        <span className="font-medium text-slate-800 flex-1">{application.applicant.full_name}</span>
                        <span className="text-slate-500 capitalize text-xs">{application.applicant.role}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowModal(false)
                            handleOpenAttModal()
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex-shrink-0"
                          title="View attendance calendar"
                        >
                          <Calendar size={12} />
                          Attendance
                        </button>
                      </div>
                    )}
                    <div className="flex gap-4 text-xs text-slate-600">
                      <span>{LEAVE_TYPE_LABELS[application.leave_type]}</span>
                      <span>·</span>
                      <span>{days} day{days > 1 ? 's' : ''}</span>
                    </div>
                    <p className="text-xs text-slate-600 whitespace-pre-wrap">{application.reason}</p>
                  </div>

                  {/* Application attachment preview */}
                  {application.attachment_url && application.attachment_name && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-1.5">Application Attachment</p>
                      <AttachmentView url={application.attachment_url} name={application.attachment_name} />
                    </div>
                  )}

                  {/* Comments */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1 block">
                      <MessageSquare size={13} /> Comments <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={comments}
                      onChange={e => setComments(e.target.value)}
                      placeholder="Add a note for the student…"
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
                    />
                  </div>

                  {/* Attachment for decision */}
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-1.5">
                      Attach document <span className="text-slate-400 font-normal">(optional)</span>
                    </p>
                    <FilePickerButton
                      file={decisionFile}
                      onFile={setDecisionFile}
                      onClear={() => setDecisionFile(null)}
                    />
                  </div>
                </div>

                {/* Sticky action buttons */}
                <div className="flex gap-3 px-5 py-4 border-t border-slate-100 flex-shrink-0">
                  <button
                    onClick={() => handleDecision('rejected')}
                    disabled={processing}
                    className="flex-1 px-4 py-2.5 bg-red-100 text-red-700 rounded-xl font-medium text-sm hover:bg-red-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {processing
                      ? <div className="w-3.5 h-3.5 border-2 border-red-400/30 border-t-red-600 rounded-full animate-spin" />
                      : <XCircle size={16} />}
                    Reject
                  </button>
                  <button
                    onClick={() => handleDecision('approved')}
                    disabled={processing}
                    className="flex-1 px-4 py-2.5 bg-green-500 text-white rounded-xl font-medium text-sm hover:bg-green-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {processing
                      ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <CheckCircle size={16} />}
                    Approve
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Attendance calendar popup */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showAttModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowAttModal(false)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 16 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
                  <Avatar
                    avatarUrl={application.applicant?.avatar_url ?? null}
                    name={application.applicant?.full_name ?? ''}
                    size={32}
                    userId={application.applicant_id}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">
                      {application.applicant?.full_name}
                    </p>
                    <p className="text-[11px] text-slate-500 capitalize">
                      {application.applicant?.role}
                      {application.applicant?.grade ? ` · Gr ${application.applicant.grade}` : ''}
                      {application.applicant?.section ? ` ${application.applicant.section}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAttModal(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Homeroom tabs (students with multiple homerooms) */}
                {!isApplicantStaff && attHomerooms.length > 1 && (
                  <div className="px-5 pt-3 flex gap-2 flex-wrap flex-shrink-0">
                    {attHomerooms.map(hr => (
                      <button
                        key={hr.id}
                        onClick={() => setAttHomeroomId(hr.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          attHomeroomId === hr.id
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {hr.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Calendar */}
                <div className="overflow-y-auto flex-1 px-4 py-4">
                  {isApplicantStaff ? (
                    <StaffAttendanceCalendarDynamic
                      staffId={application.applicant_id}
                      staffName={application.applicant?.full_name}
                      mode="self"
                      viewerUserId={currentUserId}
                      viewerRole={currentUserRole}
                      onViewLeave={app => { setShowAttModal(false); router.push(`/more/staff-leave?app=${app.id}`) }}
                    />
                  ) : loadingAttHomerooms ? (
                    <CalendarLoadingFallback />
                  ) : attHomeroomId ? (
                    <AttendanceCalendarDynamic
                      studentId={application.applicant_id}
                      homeroomId={attHomeroomId}
                      year={attYear}
                      month={attMonth}
                      onMonthChange={(y, m) => { setAttYear(y); setAttMonth(m) }}
                      viewerUserId={currentUserId}
                      viewerRole={currentUserRole}
                      onAppOpen={app => { setShowAttModal(false); router.push(`/more/leave?openApp=${app.id}`) }}
                    />
                  ) : (
                    <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                      No homeroom assigned
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
