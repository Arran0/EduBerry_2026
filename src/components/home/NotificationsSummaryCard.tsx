'use client'

import React from 'react'
import Link from 'next/link'
import { CheckCircle2, XCircle, Inbox } from 'lucide-react'
import {
  fetchMyLeaveApplications,
  fetchActiveApprovalsForStaff,
  LEAVE_TYPE_LABELS,
  type LeaveApplicationWithDetails,
} from '@/lib/leave'

type Tone = 'approved' | 'rejected' | 'incoming'

export interface NotifItem {
  id: string
  tone: Tone
  text: string
  href: string
  ts: number
}

const MAX_ITEMS = 5

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()
  return `${date}, ${time}`
}

function applicantLabel(app: LeaveApplicationWithDetails): string {
  const p = app.applicant
  if (!p) return 'a member'
  const name = p.full_name || 'a member'
  if (p.role === 'student' && p.grade != null) {
    return `${name}, Grade ${p.grade}${p.section ? ' ' + p.section : ''}`
  }
  return name
}

/** Deep-links straight to the application: student applicants open on the
 *  leave page, staff applicants open on the staff-leave page (both already
 *  support highlighting a specific application). */
function leaveHref(isStudentApplicant: boolean, appId: string): string {
  return isStudentApplicant ? `/more/leave?openApp=${appId}` : `/more/staff-leave?app=${appId}`
}

/** Own decided applications → "X approved your leave on <when>." */
function ownDecisionItems(mode: 'student' | 'staff', apps: LeaveApplicationWithDetails[]): NotifItem[] {
  const items: NotifItem[] = []
  for (const app of apps) {
    for (const ap of app.approvals) {
      if ((ap.status !== 'approved' && ap.status !== 'rejected') || !ap.decided_at) continue
      const who = ap.approver?.full_name || 'A reviewer'
      const verb = ap.status === 'approved' ? 'approved' : 'rejected'
      items.push({
        id: ap.id,
        tone: ap.status,
        text: `${who} ${verb} your ${LEAVE_TYPE_LABELS[app.leave_type]} on ${formatDateTime(ap.decided_at)}.`,
        href: leaveHref(mode === 'student', app.id),
        ts: new Date(ap.decided_at).getTime(),
      })
    }
  }
  return items
}

/** Pending applications awaiting this staffer → "New leave application from …". */
function incomingItems(apps: LeaveApplicationWithDetails[]): NotifItem[] {
  return apps.map(app => ({
    id: app.id,
    tone: 'incoming' as Tone,
    text: `New leave application from ${applicantLabel(app)} on ${formatDateTime(app.created_at)}.`,
    href: leaveHref(app.applicant?.role === 'student', app.id),
    ts: new Date(app.created_at).getTime(),
  }))
}

/** Fetches and builds the (already sorted + capped to 5) notification
 *  sentences for the home card. Used by the home page to decide whether the
 *  slot should render at all. */
export async function fetchNotificationItems(userId: string, mode: 'student' | 'staff'): Promise<NotifItem[]> {
  const list = mode === 'staff'
    ? await Promise.all([fetchActiveApprovalsForStaff(userId), fetchMyLeaveApplications(userId)])
        .then(([incoming, mine]) => [...incomingItems(incoming), ...ownDecisionItems('staff', mine)])
    : await fetchMyLeaveApplications(userId).then(mine => ownDecisionItems('student', mine))

  list.sort((a, b) => b.ts - a.ts)
  return list.slice(0, MAX_ITEMS)
}

const TONE_ICON: Record<Tone, React.ReactNode> = {
  approved: <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />,
  rejected: <XCircle size={15} className="text-red-400 flex-shrink-0" />,
  incoming: <Inbox size={15} className="text-sky-500 flex-shrink-0" />,
}

interface NotificationsSummaryCardProps {
  items: NotifItem[]
}

/** Turns the user's leave notifications (the only More-Apps badge source) into
 *  plain-language sentences, one per row, sized to fit without scrolling. The
 *  outer SectionHeading already reads "Notifications" so rows skip repeating it. */
export default function NotificationsSummaryCard({ items }: NotificationsSummaryCardProps) {
  return (
    <div className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      <div className="flex-1 divide-y divide-white/25">
        {items.map(item => (
          <Link key={item.id} href={item.href}>
            <div className="flex items-start gap-2.5 px-5 py-3 hover:bg-white/45 transition-colors group cursor-pointer">
              <span className="mt-0.5">{TONE_ICON[item.tone]}</span>
              <p className="flex-1 min-w-0 text-[13px] leading-snug text-slate-600">{item.text}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
