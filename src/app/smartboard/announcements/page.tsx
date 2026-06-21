'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Megaphone, ExternalLink } from 'lucide-react'
import SmartboardLayout from '@/components/SmartboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { fetchSmartboardContext } from '@/lib/smartboard'
import { AnnouncementWithDetails, fetchHomeroomAnnouncements } from '@/lib/announcements'

function AnnouncementSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="h-4 w-1/2 bg-slate-100 rounded animate-pulse" />
          <div className="h-3 w-full bg-slate-100 rounded animate-pulse mt-3" />
          <div className="h-3 w-2/3 bg-slate-100 rounded animate-pulse mt-2" />
        </div>
      ))}
    </div>
  )
}

export default function SmartboardAnnouncementsPage() {
  const { profile, dataRefreshKey } = useAuth()
  const [items, setItems] = useState<AnnouncementWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const ctx = await fetchSmartboardContext(profile.id)
    const hr = ctx.homeroom
    const data = await fetchHomeroomAnnouncements(hr?.grade ?? null, hr?.section ?? null, 20)
    setItems(data)
    setLoading(false)
  }, [profile])

  useEffect(() => { load() }, [load, dataRefreshKey])

  return (
    <SmartboardLayout>
      <div className="space-y-5">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center flex-shrink-0">
            <Megaphone size={18} className="text-rose-600" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-800 leading-tight">Announcements</h1>
            <p className="text-xs text-slate-400">Notices for your homeroom</p>
          </div>
        </div>

        {loading ? (
          <AnnouncementSkeleton />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <Megaphone size={28} className="text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No announcements for this homeroom yet.</p>
          </div>
        ) : (
          <motion.div
            className="space-y-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
          >
            {items.map(a => (
              <article key={a.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold text-slate-800">{a.title}</h2>
                  <span className="text-[11px] text-slate-400 flex-shrink-0 whitespace-nowrap">
                    {new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap leading-relaxed">{a.content}</p>

                {a.attachments && a.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.attachments.map((att, i) => (
                      att.type === 'image' ? (
                        <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden border border-slate-200 max-w-[160px]">
                          <img src={att.url} alt={att.name} className="w-full h-24 object-cover" />
                        </a>
                      ) : (
                        <a
                          key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 text-slate-600 text-xs font-medium hover:bg-slate-100 border border-slate-200"
                        >
                          <ExternalLink size={12} /> {att.name || att.type}
                        </a>
                      )
                    ))}
                  </div>
                )}

                <p className="text-[11px] text-slate-400 mt-3">
                  {a.creator?.full_name ?? 'Staff'}
                </p>
              </article>
            ))}
          </motion.div>
        )}
      </div>
    </SmartboardLayout>
  )
}
