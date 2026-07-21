'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, CheckCircle2, XCircle, Inbox, ChevronRight } from 'lucide-react'
import {
  fetchMyLeaveApplications,
  fetchActiveApprovalsForStaff,
  LEAVE_TYPE_LABELS,
  type LeaveApplicationWithDetails,
} from '@/lib/leave'

type Tone = 'approved' | 'rejected' | 'incoming'

interface NotifItem {
  id: string
  tone: Tone
  text: string
  href: string
  ts: number
}

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

/** Own decided applications → "X approved your leave on <when>." */
function ownDecisionItems(apps: LeaveApplicationWithDetails[]): NotifItem[] {
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
        href: '/more/leave',
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
    href: app.applicant?.role === 'student' ? '/more/leave' : '/more/staff-leave',
    ts: new Date(app.created_at).getTime(),
  }))
}

const TONE_ICON: Record<Tone, React.ReactNode> = {
  approved: <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />,
  rejected: <XCircle size={15} className="text-red-400 flex-shrink-0" />,
  incoming: <Inbox size={15} className="text-sky-500 flex-shrink-0" />,
}

interface NotificationsSummaryCardProps {
  userId: string
  mode: 'student' | 'staff'
}

/** Turns the user's leave notifications (the only More-Apps badge source) into
 *  a scrollable list of plain-language sentences. */
export default function NotificationsSummaryCard({ userId, mode }: NotificationsSummaryCardProps) {
  const [items, setItems] = useState<NotifItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const work = mode === 'staff'
      ? Promise.all([fetchActiveApprovalsForStaff(userId), fetchMyLeaveApplications(userId)])
          .then(([incoming, mine]) => [...incomingItems(incoming), ...ownDecisionItems(mine)])
      : fetchMyLeaveApplications(userId).then(mine => ownDecisionItems(mine))

    work
      .then(list => {
        if (cancelled) return
        list.sort((a, b) => b.ts - a.ts)
        setItems(list)
      })
      .catch(err => {
        console.error('Failed to load notifications for home card:', err)
        if (!cancelled) setItems([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, mode])

  return (
    <div className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-white/25 flex items-center gap-2">
        <Bell size={16} className="text-sky-500" />
        <span className="text-sm font-bold text-slate-700">Notifications</span>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="spinner" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
            <Bell size={22} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-400">You&apos;re all caught up</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-white/25">
          {items.map(item => (
            <Link key={item.id} href={item.href}>
              <div className="flex items-start gap-2.5 px-5 py-3 hover:bg-white/45 transition-colors group cursor-pointer">
                <span className="mt-0.5">{TONE_ICON[item.tone]}</span>
                <p className="flex-1 min-w-0 text-[13px] leading-snug text-slate-600">{item.text}</p>
                <ChevronRight size={14} className="flex-shrink-0 mt-0.5 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
