'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Bell, ChevronRight, Megaphone } from 'lucide-react'
import { AnnouncementWithDetails, fetchHomeroomAnnouncements } from '@/lib/announcements'

interface SmartboardAnnouncementsProps {
  grade: number | null
  section: string | null
  className?: string
}

const DOT_COLORS = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
]

function relativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (same(date, now)) return 'Today'
  if (same(date, yesterday)) return 'Yesterday'
  const diff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000
  )
  if (diff < 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function SmartboardAnnouncements({ grade, section, className = '' }: SmartboardAnnouncementsProps) {
  const [items, setItems] = useState<AnnouncementWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchHomeroomAnnouncements(grade, section, 5)
    setItems(data)
    setLoading(false)
  }, [grade, section])

  useEffect(() => { load() }, [load])

  return (
    <section className={`flex flex-col ${className}`}>
      {/* Header — matches home page "Latest Announcements" header (slimmer) */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-sm flex-shrink-0">
            <Bell size={12} className="text-white" />
          </div>
          <h2 className="font-display text-sm font-bold text-slate-800">Latest Announcements</h2>
        </div>
        <Link
          href="/announcements"
          className="text-sky-600 hover:text-sky-700 text-xs font-medium flex items-center gap-0.5 transition-colors"
        >
          View all <ChevronRight size={13} />
        </Link>
      </div>

      {/* Glass card — matches home page announcement list */}
      <div
        className="rounded-2xl overflow-hidden divide-y divide-white/20 shadow-md border border-white/50 flex-1"
        style={{
          background: 'linear-gradient(160deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.14) 100%)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
        }}
      >
        {loading ? (
          [0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5">
              <div className="w-1 h-5 rounded-full bg-slate-200 animate-pulse flex-shrink-0" />
              <div className="flex-1 h-3.5 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-12 bg-slate-100 rounded-full animate-pulse" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="py-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-white/40 flex items-center justify-center mx-auto mb-2">
              <Megaphone size={18} className="text-slate-300" />
            </div>
            <p className="text-xs font-medium text-slate-400">No announcements yet</p>
            <p className="text-[10px] text-slate-300 mt-0.5">Check back later for updates</p>
          </div>
        ) : (
          items.map((a, i) => (
            <Link key={a.id} href="/announcements">
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-white/40 transition-colors group cursor-pointer">
                <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${DOT_COLORS[i % DOT_COLORS.length]}`} />
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-slate-800 text-[13px] truncate group-hover:text-slate-900 transition-colors">
                    {a.title}
                  </h4>
                </div>
                <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/50 text-slate-500 group-hover:bg-white/70 transition-colors">
                  {relativeDate(a.created_at)}
                </span>
                <ChevronRight size={13} className="flex-shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  )
}
