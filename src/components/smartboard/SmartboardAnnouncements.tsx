'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Megaphone, ArrowRight } from 'lucide-react'
import { AnnouncementWithDetails, fetchHomeroomAnnouncements } from '@/lib/announcements'

interface SmartboardAnnouncementsProps {
  grade: number | null
  section: string | null
  /** Stretch to fill the column (used to height-match the leaderboard). */
  className?: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function SmartboardAnnouncements({ grade, section, className = '' }: SmartboardAnnouncementsProps) {
  const [items, setItems] = useState<AnnouncementWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchHomeroomAnnouncements(grade, section, 3)
    setItems(data)
    setLoading(false)
  }, [grade, section])

  useEffect(() => { load() }, [load])

  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col ${className}`}>
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2 border-b border-slate-100">
        <Megaphone size={15} className="text-rose-500" />
        <h2 className="font-display text-sm font-bold text-slate-800 flex-1">Latest Announcements</h2>
        <Link href="/smartboard/announcements" className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 flex items-center gap-0.5">
          All <ArrowRight size={11} />
        </Link>
      </div>

      <div className="flex-1 p-2 space-y-1.5 overflow-hidden">
        {loading ? (
          [0, 1, 2].map(i => (
            <div key={i} className="rounded-xl border border-slate-100 px-3 py-2">
              <div className="h-3.5 w-2/3 bg-slate-100 rounded animate-pulse" />
              <div className="h-2.5 w-1/3 bg-slate-100 rounded animate-pulse mt-2" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center h-full text-center py-6">
            <p className="text-xs text-slate-400">No announcements for this homeroom yet.</p>
          </div>
        ) : (
          items.map(a => (
            <Link
              key={a.id}
              href="/smartboard/announcements"
              className="block rounded-xl border border-slate-100 px-3 py-2 hover:border-rose-200 hover:bg-rose-50/40 transition-colors"
            >
              <p className="text-sm font-semibold text-slate-800 truncate">{a.title}</p>
              <p className="text-[11px] text-slate-500 line-clamp-1">{a.content}</p>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400">
                <span>{a.creator?.full_name ?? 'Staff'}</span>
                <span>·</span>
                <span>{timeAgo(a.created_at)}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  )
}
