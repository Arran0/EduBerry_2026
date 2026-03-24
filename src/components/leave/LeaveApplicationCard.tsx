'use client'

import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar,
  Clock,
  User,
  CheckCircle,
  XCircle,
  MessageSquare,
  Paperclip,
  ImageIcon,
  FileText,
  File,
  X,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  LeaveApplicationWithDetails,
  LeaveApproval,
  processLeaveApproval,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_COLORS,
  isImageFile,
} from '@/lib/leave'

interface LeaveApplicationCardProps {
  application: LeaveApplicationWithDetails
  currentUserId: string
  currentUserRole: string
  isApprover?: boolean
  onStatusChange?: () => void
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRelativeDate(d: string): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff} days ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function calcDays(start: string, end: string): number {
  return Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
}

function AttachmentView({ url, name }: { url: string; name: string }) {
  const isImg = isImageFile(name)
  const [open, setOpen] = useState(isImg)

  if (isImg) {
    return (
      <div className="space-y-1.5">
        <button
          onClick={() => setOpen(p => !p)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ImageIcon size={12} />
          <span className="truncate max-w-[160px]">{name}</span>
          <span className="text-slate-400">{open ? '▲ hide' : '▼ show'}</span>
        </button>
        {open && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img
              src={url}
              alt={name}
              className="rounded-xl max-h-52 max-w-full object-contain border border-slate-100 hover:opacity-90 transition-opacity"
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
      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors"
    >
      <FileText size={12} />
      <span className="truncate max-w-[200px]">{name}</span>
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
            {isImg ? <ImageIcon size={13} className="text-blue-500 flex-shrink-0" /> : <File size={13} className="text-slate-400 flex-shrink-0" />}
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
  onStatusChange,
}: LeaveApplicationCardProps) {
  const [showModal, setShowModal] = useState(false)
  const [selectedApproval, setSelectedApproval] = useState<LeaveApproval | null>(null)
  const [comments, setComments] = useState('')
  const [decisionFile, setDecisionFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)

  const days = calcDays(application.start_date, application.end_date)

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

  return (
    <>
      <div className="glass rounded-2xl p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${application.leave_type === 'casual' ? 'bg-blue-100' : 'bg-purple-100'}`}>
              <Calendar size={18} className={application.leave_type === 'casual' ? 'text-blue-600' : 'text-purple-600'} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 text-sm">{LEAVE_TYPE_LABELS[application.leave_type]}</h3>
              <p className="text-xs text-slate-500">{formatRelativeDate(application.created_at)}</p>
            </div>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${LEAVE_STATUS_COLORS[application.status]}`}>
            {LEAVE_STATUS_LABELS[application.status]}
          </span>
        </div>

        {/* Applicant info (for staff views) */}
        {application.applicant && currentUserId !== application.applicant_id && (
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl">
            <Avatar avatarUrl={application.applicant.avatar_url} name={application.applicant.full_name} size={28} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{application.applicant.full_name}</p>
              <p className="text-xs text-slate-500 capitalize">{application.applicant.role}
                {application.applicant.grade ? ` · Grade ${application.applicant.grade}` : ''}
                {application.applicant.section ? ` ${application.applicant.section}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <div className="flex items-center gap-1.5 text-slate-600">
            <Calendar size={13} />
            <span>{formatDate(application.start_date)}</span>
            <span className="text-slate-400">→</span>
            <span>{formatDate(application.end_date)}</span>
          </div>
          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
            {days} day{days > 1 ? 's' : ''}
          </span>
        </div>

        {/* Reason */}
        <div className="bg-slate-50 px-3 py-2.5 rounded-xl">
          <p className="text-xs font-semibold text-slate-500 mb-1">Reason</p>
          <p className="text-sm text-slate-700">{application.reason}</p>
        </div>

        {/* Application attachment */}
        {application.attachment_url && application.attachment_name && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Attachment</p>
            <AttachmentView url={application.attachment_url} name={application.attachment_name} />
          </div>
        )}

        {/* Approval trail */}
        {application.approvals.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-500">Approval Status</p>
            {application.approvals.map(a => (
              <div key={a.id} className={`text-xs px-3 py-2 rounded-lg ${
                a.status === 'approved' ? 'bg-green-50' : a.status === 'rejected' ? 'bg-red-50' : 'bg-amber-50'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {a.status === 'approved' && <CheckCircle size={12} className="text-green-600" />}
                    {a.status === 'rejected' && <XCircle size={12} className="text-red-600" />}
                    {a.status === 'pending' && <Clock size={12} className="text-amber-600" />}
                    <span className="font-medium">{a.approver?.full_name ?? a.approver_role}</span>
                  </div>
                  <span className={`font-medium ${
                    a.status === 'approved' ? 'text-green-700' : a.status === 'rejected' ? 'text-red-700' : 'text-amber-700'
                  }`}>{LEAVE_STATUS_LABELS[a.status]}</span>
                </div>
                {a.comments && (
                  <p className={`mt-1 pl-5 italic leading-snug ${a.status === 'rejected' ? 'text-red-700' : 'text-slate-600'}`}>
                    "{a.comments}"
                  </p>
                )}
                {a.attachment_url && a.attachment_name && (
                  <div className="mt-1.5 pl-5">
                    <AttachmentView url={a.attachment_url} name={a.attachment_name} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Approver actions */}
        {isApprover && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            {myPendingApprovals.map(a => (
              <button key={a.id} onClick={() => openModal(a)}
                className="w-full btn-primary text-sm flex items-center justify-center gap-2">
                Review & Decide
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Decision Modal */}
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
                        <Avatar avatarUrl={application.applicant.avatar_url} name={application.applicant.full_name} size={24} />
                        <span className="font-medium text-slate-800">{application.applicant.full_name}</span>
                        <span className="text-slate-500 capitalize text-xs">{application.applicant.role}</span>
                      </div>
                    )}
                    <div className="flex gap-4 text-xs text-slate-600">
                      <span>{LEAVE_TYPE_LABELS[application.leave_type]}</span>
                      <span>·</span>
                      <span>{days} day{days > 1 ? 's' : ''}</span>
                    </div>
                    <p className="text-xs text-slate-600">{application.reason}</p>
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
                    <p className="text-sm font-medium text-slate-700 mb-1.5">Attach document <span className="text-slate-400 font-normal">(optional)</span></p>
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
                    {processing ? <div className="w-3.5 h-3.5 border-2 border-red-400/30 border-t-red-600 rounded-full animate-spin" /> : <XCircle size={16} />}
                    Reject
                  </button>
                  <button
                    onClick={() => handleDecision('approved')}
                    disabled={processing}
                    className="flex-1 px-4 py-2.5 bg-green-500 text-white rounded-xl font-medium text-sm hover:bg-green-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {processing ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={16} />}
                    Approve
                  </button>
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
