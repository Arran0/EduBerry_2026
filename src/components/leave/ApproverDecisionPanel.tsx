'use client'

import React, { useRef, useState } from 'react'
import { CheckCircle, XCircle, MessageSquare, Paperclip, ImageIcon, File, X } from 'lucide-react'
import { LeaveApproval, processLeaveApproval, isImageFile } from '@/lib/leave'

/** Optional decision attachment — a signed note, a sanction letter, a photo. */
export function FilePickerButton({
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

interface ApproverDecisionPanelProps {
  /** The pending approval row this viewer is being asked to decide. */
  approval: LeaveApproval
  currentUserId: string
  /** Names which hat the viewer is wearing — only shown when an application
   *  is waiting on more than one of the viewer's approvals. */
  showRoleLabel?: boolean
  /** Fires after the decision is written, so the host can refresh its list. */
  onDecided?: () => void
}

/**
 * Remarks box plus Approve / Reject, rendered inline wherever an approver is
 * looking at a pending application. It replaces the old "Review & Decide"
 * button, which only opened a second popup holding these same three controls —
 * an extra hop on a decision that is usually made at a glance.
 *
 * Owns its own draft state so several panels (one per pending approval) can sit
 * on the same application without sharing a remarks box.
 */
export default function ApproverDecisionPanel({
  approval, currentUserId, showRoleLabel = false, onDecided,
}: ApproverDecisionPanelProps) {
  const [comments, setComments] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [showAttach, setShowAttach] = useState(false)
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (decision: 'approved' | 'rejected') => {
    if (deciding) return
    setDeciding(decision)
    setError(null)
    const res = await processLeaveApproval(
      approval.id, currentUserId, decision, comments, file ?? undefined
    )
    if (!res.ok) {
      setDeciding(null)
      setError('Could not save that decision. Please try again.')
      return
    }
    if (!res.attendanceSynced) {
      // The decision is saved and must not be retried — but the attendance rows it
      // should have written are missing, so the card stays put and says so rather
      // than disappearing on a half-done job.
      setDeciding(null)
      setError('Decision saved, but attendance was not updated for these dates. Please mark it manually.')
      return
    }
    // Left spinning on success — the host removes or re-renders this card.
    onDecided?.()
  }

  const busy = deciding !== null

  return (
    <div className="pt-2.5 border-t border-slate-100 space-y-2">
      {showRoleLabel && (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Your decision as {approval.approver_role}
        </p>
      )}

      <div className="relative">
        <MessageSquare size={12} className="absolute left-2.5 top-2.5 text-slate-300 pointer-events-none" />
        <textarea
          value={comments}
          onChange={e => setComments(e.target.value)}
          disabled={busy}
          placeholder="Add remarks (optional)…"
          rows={2}
          className="w-full border border-slate-200 rounded-xl pl-7 pr-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none disabled:opacity-60"
        />
      </div>

      {/* The attachment is the rare case, so it stays folded away until asked
          for rather than taking a third of the panel on every application. */}
      {showAttach || file ? (
        <FilePickerButton file={file} onFile={setFile} onClear={() => { setFile(null); setShowAttach(false) }} />
      ) : (
        <button
          type="button"
          onClick={() => setShowAttach(true)}
          disabled={busy}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-60"
        >
          <Paperclip size={11} />
          Attach a document
        </button>
      )}

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => decide('rejected')}
          disabled={busy}
          className="flex-1 px-3 py-2 bg-red-50 text-red-700 border border-red-100 rounded-xl font-semibold text-[13px] hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {deciding === 'rejected'
            ? <span className="w-3.5 h-3.5 border-2 border-red-400/30 border-t-red-600 rounded-full animate-spin" />
            : <XCircle size={15} />}
          Reject
        </button>
        <button
          onClick={() => decide('approved')}
          disabled={busy}
          className="flex-1 px-3 py-2 bg-green-500 text-white rounded-xl font-semibold text-[13px] hover:bg-green-600 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {deciding === 'approved'
            ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <CheckCircle size={15} />}
          Approve
        </button>
      </div>
    </div>
  )
}
