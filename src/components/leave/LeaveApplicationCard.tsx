'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  Calendar,
  Sunset,
  Clock,
  CheckCircle,
  XCircle,
  ImageIcon,
  FileText,
  X,
  Trash2,
  ChevronDown,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  LeaveApplicationWithDetails,
  LeaveType,
  deleteLeaveApplication,
  markLeaveApplicationViewed,
  LEAVE_TYPE_LABELS,
  LEAVE_TYPE_SHORT,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_COLORS,
  isImageFile,
} from '@/lib/leave'
import ApproverDecisionPanel from '@/components/leave/ApproverDecisionPanel'
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

/**
 * `card` is the standalone surface — a rounded panel that shows everything,
 * used by the detail popup and the student leave page. `row` is the mail-list
 * presentation: a flush, edge-to-edge line that stays shut until tapped.
 */
export type LeaveCardVariant = 'card' | 'row'

interface LeaveApplicationCardProps {
  application: LeaveApplicationWithDetails
  currentUserId: string
  currentUserRole: string
  isApprover?: boolean
  canDelete?: boolean
  onStatusChange?: () => void
  variant?: LeaveCardVariant
  /**
   * Opens another staff application picked from the applicant's attendance
   * calendar. Without it the card navigates to the Staff OD / Leave page —
   * which yanks the reader out of whatever is hosting this card.
   */
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
}

const TYPE_STYLE = {
  casual:   { accentFrom: 'from-blue-400',   iconBg: 'bg-blue-50',   iconColor: 'text-blue-500',   pill: 'bg-blue-50 text-blue-600' },
  on_duty:  { accentFrom: 'from-teal-400',   iconBg: 'bg-teal-50',   iconColor: 'text-teal-500',   pill: 'bg-teal-50 text-teal-600' },
  medical:  { accentFrom: 'from-purple-400', iconBg: 'bg-purple-50', iconColor: 'text-purple-500', pill: 'bg-purple-50 text-purple-600' },
  half_day: { accentFrom: 'from-orange-400', iconBg: 'bg-orange-50', iconColor: 'text-orange-500', pill: 'bg-orange-50 text-orange-600' },
} as const

const TYPE_ICON: Record<LeaveType, React.ElementType> = {
  casual: Calendar,
  on_duty: Calendar,
  medical: Calendar,
  half_day: Sunset,
}

/** Short pill text for the header row, e.g. "3d" or "½d". */
function dayCountShort(type: LeaveType, days: number): string {
  return type === 'half_day' ? '½d' : `${days}d`
}


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

/**
 * The timestamp a mail list shows on the right of each row: time for today,
 * day + month within this year, and a numeric date beyond it — so the column
 * stays narrow no matter how old the application is.
 */
function formatListDate(d: string): string {
  const date = new Date(d)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
  }
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
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

export default function LeaveApplicationCard({
  application,
  currentUserId,
  currentUserRole,
  isApprover = false,
  canDelete = false,
  onStatusChange,
  variant = 'card',
  onViewLeave,
}: LeaveApplicationCardProps) {
  const router = useRouter()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isRow = variant === 'row'
  const days = calcDays(application.start_date, application.end_date)
  const ts = TYPE_STYLE[application.leave_type]
  const TypeIcon = TYPE_ICON[application.leave_type]
  const isOwnApplication = application.applicant_id === currentUserId
  const isApplicantStaff = application.applicant ? isStaffRole(application.applicant.role as any) : false

  // A row stays shut until tapped, like a mail list. The card variant keeps its
  // old behaviour: decided applications summarise, pending ones show in full so
  // the Approve/Reject action is never a click away.
  const collapsible = isRow || application.status !== 'pending'
  const [expanded, setExpanded] = useState(!collapsible)
  const showBody = !collapsible || expanded
  // The live app only ever creates one approval per application (a named
  // recipient) — the multi-approver trail below is kept for the rare/legacy
  // case, but this is what almost every card actually has.
  const soleApproval = application.approvals.length === 1 ? application.approvals[0] : null

  /**
   * Who sits on the other end of this application: the approver on something
   * you sent, the applicant on something you received. A mail list is only
   * legible if each row names the *other* party rather than repeating you.
   */
  const namedApproval = application.approvals.find(a => a.approver_id) ?? application.approvals[0]
  const counterparty = isOwnApplication
    ? {
        name: namedApproval?.approver?.full_name ?? namedApproval?.approver_role ?? 'Unassigned',
        avatarUrl: namedApproval?.approver?.avatar_url ?? null,
        detail: namedApproval?.approver?.role ?? namedApproval?.approver_role ?? '',
        prefix: 'To ',
      }
    : {
        name: application.applicant?.full_name ?? '—',
        avatarUrl: application.applicant?.avatar_url ?? null,
        detail: [
          application.applicant?.role,
          application.applicant?.grade ? `Gr ${application.applicant.grade}` : null,
          application.applicant?.section,
        ].filter(Boolean).join(' · '),
        prefix: '',
      }

  /**
   * Unread in the mail sense: something changed since you last opened this.
   * Suppressed on your own still-pending application — you wrote it, so there
   * is nothing there you haven't seen.
   */
  const myView = application.views.find(v => v.user_id === currentUserId)
  const viewIsStale = !myView ||
    new Date(myView.viewed_at).getTime() < new Date(application.updated_at).getTime()
  const [readLocally, setReadLocally] = useState(false)
  const unread = viewIsStale && !readLocally &&
    !(isOwnApplication && application.status === 'pending')

  /**
   * Record that this user has seen the application as it stands. A row only
   * counts as seen once it is actually opened — that is what makes "has the
   * teacher seen the decision?" mean something. An always-open card marks on
   * mount, since rendering it *is* opening it.
   */
  const markSeen = useCallback(() => {
    setReadLocally(true)
    if (viewIsStale) markLeaveApplicationViewed(application.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id, viewIsStale])

  useEffect(() => {
    if (!isRow && viewIsStale) markLeaveApplicationViewed(application.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id, application.updated_at, isRow])

  const toggleExpanded = () => {
    setExpanded(open => {
      if (!open) markSeen()
      return !open
    })
  }

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

  const handleDelete = async () => {
    setDeleting(true)
    const ok = await deleteLeaveApplication(application.id)
    setDeleting(false)
    setShowDeleteConfirm(false)
    if (ok && onStatusChange) onStatusChange()
  }

  /** Status as a compact chip — icon plus word, sized to sit inside a row. */
  const statusChip = (
    <span className={`flex items-center gap-1 flex-shrink-0 px-1.5 py-[1px] rounded-full text-[10px] font-semibold border ${LEAVE_STATUS_COLORS[application.status]}`}>
      {application.status === 'approved' && <CheckCircle size={9} />}
      {application.status === 'rejected' && <XCircle size={9} />}
      {application.status === 'pending'  && <Clock size={9} />}
      {LEAVE_STATUS_LABELS[application.status]}
    </span>
  )

  /**
   * Everything below the header — reason, attachments, approval trail and the
   * approver's action. Shared by both variants so a row and a card can never
   * describe the same application differently.
   */
  const detailBody = (
    <>
      {/* Reason */}
      <p className={`text-slate-600 leading-relaxed whitespace-pre-wrap ${isRow ? 'text-[13px]' : 'text-sm'}`}>
        {application.reason}
      </p>

      {/* Application attachment */}
      {application.attachment_url && application.attachment_name && (
        <AttachmentView url={application.attachment_url} name={application.attachment_name} />
      )}

      {/* Approval trail — a compact single line for the common case of
          one named approver (no point repeating the status pill above
          as a whole trail block); the fuller per-approver trail only
          earns its space when there's more than one to distinguish. */}
      {soleApproval ? (
        soleApproval.status !== 'pending' && (
          <div className="border-t border-slate-100 pt-2 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              {soleApproval.status === 'approved' && <CheckCircle size={12} className="text-green-500 flex-shrink-0" />}
              {soleApproval.status === 'rejected' && <XCircle size={12} className="text-red-500 flex-shrink-0" />}
              <span className="truncate">
                {soleApproval.approver?.full_name ?? soleApproval.approver_role}
                {soleApproval.decided_at && ` · ${formatDecidedAt(soleApproval.decided_at)}`}
              </span>
            </div>
            {soleApproval.comments && (
              <p className="text-xs text-slate-500 italic leading-relaxed">
                &ldquo;{soleApproval.comments}&rdquo;
              </p>
            )}
            {soleApproval.attachment_url && soleApproval.attachment_name && (
              <AttachmentView url={soleApproval.attachment_url} name={soleApproval.attachment_name} />
            )}
          </div>
        )
      ) : application.approvals.length > 0 && (
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

      {/* Approver actions — remarks and the two buttons sit right here, so a
          decision never costs a trip through a second popup. */}
      {isApprover && myPendingApprovals.length > 0 && (
        <div className="space-y-2">
          {myPendingApprovals.map(a => (
            <ApproverDecisionPanel
              key={a.id}
              approval={a}
              currentUserId={currentUserId}
              showRoleLabel={myPendingApprovals.length > 1}
              onDecided={() => onStatusChange?.()}
            />
          ))}
        </div>
      )}
    </>
  )

  /**
   * Mail-list row. Three lines and no card chrome: who it involves and when,
   * what was asked for and how it went, then a one-line peek at the reason.
   * The whole line is the toggle, so the tap target runs the full width of the
   * screen and no space is spent on a separate chevron column.
   */
  const rowSurface = (
    <div className={`relative transition-colors ${expanded ? 'bg-slate-50/80' : 'bg-white'}`}>
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        className="relative w-full text-left flex items-center gap-2.5 px-3 sm:px-4 py-2.5 hover:bg-slate-50 active:bg-slate-100/80 transition-colors"
      >
        {/* Unread rail — the only thing that marks a row as needing attention */}
        {unread && (
          <span
            aria-hidden
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
            style={{ background: 'var(--page-primary, #7c3aed)' }}
          />
        )}

        <Avatar avatarUrl={counterparty.avatarUrl} name={counterparty.name} size={34} />

        <div className="flex-1 min-w-0">
          {/* Line 1 — the other party, and when this landed */}
          <div className="flex items-center gap-2">
            <span className={`truncate text-[13px] leading-tight ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
              {counterparty.prefix}{counterparty.name}
            </span>
            <span className="ml-auto flex items-center gap-1 flex-shrink-0">
              <span className="text-[10.5px] text-slate-400 tabular-nums">
                {formatListDate(application.created_at)}
              </span>
            </span>
          </div>

          {/* Line 2 — what was asked for, and how it went */}
          <div className="flex items-center gap-1.5 mt-[3px]">
            <span className={`px-1.5 py-[1px] rounded text-[10px] font-bold flex-shrink-0 ${ts.pill}`}>
              {LEAVE_TYPE_SHORT[application.leave_type]}
            </span>
            <span className="text-[12px] text-slate-600 font-medium truncate min-w-0">
              {formatShortDateRange(application.start_date, application.end_date)}
            </span>
            <span className="text-[11px] text-slate-400 flex-shrink-0">
              {dayCountShort(application.leave_type, days)}
            </span>
            <span className="ml-auto flex items-center">{statusChip}</span>
          </div>

          {/* Line 3 — a peek at the reason, the way a mail list previews a body */}
          <p className="text-[11.5px] text-slate-400 truncate mt-[3px]">{application.reason}</p>
        </div>

        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-slate-300 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 sm:px-4 pb-3.5 pt-0.5 space-y-2.5">
              {/* The full type label and the tools that would crowd a shut row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${ts.pill}`}>
                  <TypeIcon size={11} />
                  {LEAVE_TYPE_LABELS[application.leave_type]}
                </span>
                <button
                  type="button"
                  onClick={handleOpenAttModal}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  <Calendar size={11} />
                  Attendance
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-slate-500 bg-slate-100 hover:bg-red-50 hover:text-red-600 transition-colors ml-auto"
                  >
                    <Trash2 size={11} />
                    Delete
                  </button>
                )}
              </div>

              {detailBody}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  const cardSurface = (
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
            {collapsible && (
              <button
                type="button"
                onClick={toggleExpanded}
                className="p-1 text-slate-300 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                title={expanded ? 'Show less' : 'Show details'}
              >
                <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Leave type + date range + status */}
        <div className="flex items-center gap-2">
          <div className={`flex-shrink-0 p-1.5 rounded-lg ${ts.iconBg}`}>
            <TypeIcon size={13} className={ts.iconColor} />
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
              {dayCountShort(application.leave_type, days)}
            </span>
          </div>
          <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium border ${LEAVE_STATUS_COLORS[application.status]}`}>
            {LEAVE_STATUS_LABELS[application.status]}
          </span>
        </div>

        {/* Collapsed summary — a closed application shrinks to sender,
            receiver and a couple of details; tap to see the rest. */}
        {!showBody && soleApproval && (
          <button
            type="button"
            onClick={toggleExpanded}
            className="w-full flex items-center gap-1.5 text-xs text-slate-500 pt-0.5 text-left hover:text-slate-700 transition-colors"
          >
            {soleApproval.status === 'approved' && <CheckCircle size={12} className="text-green-500 flex-shrink-0" />}
            {soleApproval.status === 'rejected' && <XCircle size={12} className="text-red-500 flex-shrink-0" />}
            <span className="truncate">
              {soleApproval.approver?.full_name ?? soleApproval.approver_role}
              {soleApproval.decided_at && ` · ${formatDecidedAt(soleApproval.decided_at)}`}
            </span>
          </button>
        )}

        {showBody && detailBody}
      </div>
    </div>
  )

  return (
    <>
      {isRow ? rowSurface : cardSurface}

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
                      onViewLeave={app => {
                        setShowAttModal(false)
                        if (onViewLeave) onViewLeave(app)
                        else router.push(`/more/staff-leave?app=${app.id}`)
                      }}
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
                      onAppOpen={app => {
                        setShowAttModal(false)
                        if (onViewLeave) onViewLeave(app)
                        else router.push(`/more/leave?openApp=${app.id}`)
                      }}
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
