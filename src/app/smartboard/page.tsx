'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { MonitorPlay, BookOpen, Users, Pencil } from 'lucide-react'
import SmartboardLayout from '@/components/SmartboardLayout'
import ClassroomButton from '@/components/classrooms/ClassroomButton'
import { ClassroomWithDetails } from '@/lib/classrooms'
import SmartboardWeeklyCalendar from '@/components/smartboard/SmartboardWeeklyCalendar'
import SmartboardHomeworkForm from '@/components/smartboard/SmartboardHomeworkForm'
import SmartboardAttendancePanel from '@/components/smartboard/SmartboardAttendancePanel'
import SmartboardBannerEditor from '@/components/smartboard/SmartboardBannerEditor'
import SmartboardTop3Loop from '@/components/smartboard/SmartboardTop3Loop'
import SmartboardAnnouncements from '@/components/smartboard/SmartboardAnnouncements'
import SmartboardQuote from '@/components/smartboard/SmartboardQuote'
import { useAuth } from '@/contexts/AuthContext'
import { fetchSmartboardContext, SmartboardContext, SmartboardTask } from '@/lib/smartboard'
import { SmartboardBanner } from '@/lib/homerooms'

export default function SmartboardDashboardPage() {
  const { profile, dataRefreshKey } = useAuth()
  const [ctx, setCtx] = useState<SmartboardContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [openTask, setOpenTask] = useState<SmartboardTask | null>(null)
  const [reloadSignal, setReloadSignal] = useState(0)
  const [showBannerEditor, setShowBannerEditor] = useState(false)
  // Optimistic banner override so a save reflects instantly without a full reload.
  const [bannerOverride, setBannerOverride] = useState<SmartboardBanner | null>(null)
  // Tracks the classroom whose page is being navigated to (instant feedback).
  const [navigatingId, setNavigatingId] = useState<string | null>(null)

  const now = new Date()
  const weekdayLabel = now.toLocaleDateString(undefined, { weekday: 'long' })
  const dateLabel = now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const data = await fetchSmartboardContext(profile.id)
    setCtx(data)
    setBannerOverride(null)
    setLoading(false)
  }, [profile])

  useEffect(() => { load() }, [load, dataRefreshKey])

  const homeroom = ctx?.homeroom
  const banner = bannerOverride ?? homeroom?.smartboard_banner ?? null
  const bannerTitle = banner?.title?.trim() || homeroom?.name || 'Smart Board'
  const colorFrom = banner?.color_from || '#6366F1'
  const colorTo = banner?.color_to || '#7C3AED'

  return (
    <SmartboardLayout>
      <div className="px-4 py-5">
      {loading ? (
        <div className="space-y-5">
          {/* Banner skeleton */}
          <div className="rounded-3xl bg-slate-200 animate-pulse h-[120px]" />
          {/* Quote skeleton */}
          <div className="rounded-2xl bg-slate-100 animate-pulse h-10" />
          {/* Attendance + leaderboard skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-slate-100 animate-pulse h-[88px]" />
            <div className="rounded-2xl bg-slate-100 animate-pulse h-[220px]" />
          </div>
          {/* Calendar skeleton */}
          <div className="rounded-2xl bg-slate-100 animate-pulse h-[200px]" />
          {/* Classroom buttons skeleton */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="rounded-full bg-slate-100 animate-pulse h-[42px]" />
            ))}
          </div>
        </div>
      ) : (
        <motion.div
          className="space-y-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {/* ── Customisable banner (title = homeroom name by default) ── */}
          <div
            className="relative overflow-hidden rounded-3xl shadow-lg"
            style={{ background: `linear-gradient(135deg, ${colorFrom}, ${colorTo})` }}
          >
            {banner?.image_url && (
              <img src={banner.image_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90" />
            )}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.18),transparent_60%)] pointer-events-none" />
            {homeroom && (
              <button
                onClick={() => setShowBannerEditor(true)}
                className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-lg text-white/90 hover:text-white text-[11px] font-medium border border-white/20 transition-colors"
              >
                <Pencil size={12} /> Customise
              </button>
            )}
            <div className="relative px-5 sm:px-8 py-5 sm:py-7 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-white/80 text-[11px] font-semibold uppercase tracking-widest mb-1">
                  <MonitorPlay size={13} /> Smart Board
                </div>
                <h1
                  className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight"
                  style={{ textShadow: '0 2px 8px rgba(0,0,0,0.25)' }}
                >
                  {bannerTitle}
                </h1>
                {homeroom?.grade && homeroom?.section && (
                  <p className="mt-1 text-white/80 text-xs font-medium">
                    Grade {homeroom.grade} · Section {homeroom.section}
                    {homeroom.academic_year ? ` · AY ${homeroom.academic_year}` : ''}
                  </p>
                )}
              </div>
              {/* Date & day, right-aligned */}
              <div className="flex-shrink-0 text-right text-white pr-1" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.3)' }}>
                <p className="text-base sm:text-xl font-bold leading-tight">{weekdayLabel}</p>
                <p className="text-[11px] sm:text-sm text-white/85 font-medium leading-tight">{dateLabel}</p>
              </div>
            </div>
          </div>

          {/* ── Quote of the day — appears and leaves below the banner ── */}
          <SmartboardQuote />

          {!homeroom && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              This smart board account isn&apos;t linked to a homeroom yet. Ask an admin to assign it in the Homeroom Manager.
            </div>
          )}

          {/* ── Left: attendance + latest announcements · Right: top-3 loop.
                 The grid stretches both columns to the same height, so the
                 attendance + announcements stack matches the leaderboard. ── */}
          {homeroom && profile && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
              <div className="flex flex-col gap-4">
                <SmartboardAttendancePanel
                  homeroomId={homeroom.id}
                  homeroomName={homeroom.name}
                  markedBy={profile.id}
                />
                <SmartboardAnnouncements
                  grade={homeroom.grade ?? null}
                  section={homeroom.section ?? null}
                  className="flex-1"
                />
              </div>
              {(ctx?.classrooms.length ?? 0) > 0 ? (
                <SmartboardTop3Loop classrooms={ctx!.classrooms} />
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex items-center justify-center p-6 text-center">
                  <p className="text-sm text-slate-400">Classroom standings appear here once this board joins a classroom.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Weekly calendar ── */}
          {homeroom && profile && (
            <SmartboardWeeklyCalendar
              homeroomId={homeroom.id}
              createdBy={profile.id}
              classrooms={ctx?.classrooms ?? []}
              onOpenTask={setOpenTask}
              reloadSignal={reloadSignal}
            />
          )}

          {/* ── Classroom shortcuts ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-indigo-500" />
              <h2 className="font-display text-lg font-bold text-slate-800">Classrooms</h2>
              <span className="text-xs text-slate-400">({ctx?.classrooms.length ?? 0})</span>
            </div>

            {(ctx?.classrooms.length ?? 0) === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
                <Users size={28} className="text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">
                  No classrooms yet. When a homeroom is imported into a classroom, this board joins it automatically.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {ctx!.classrooms.map((c, i) => (
                  <ClassroomButton
                    key={c.id}
                    classroom={{ ...c, members: [] } as ClassroomWithDetails}
                    index={i}
                    heightClass="h-[42px]"
                    navigating={navigatingId === c.id}
                    onNavigate={() => setNavigatingId(c.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </motion.div>
      )}
      </div>

      {openTask && profile && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setOpenTask(null) }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto"
          >
            <SmartboardHomeworkForm
              createdBy={profile.id}
              homeroomId={homeroom?.id ?? null}
              classrooms={ctx?.classrooms ?? []}
              task={openTask}
              onCancel={() => setOpenTask(null)}
              onUpdated={() => { setOpenTask(null); setReloadSignal(s => s + 1) }}
              onDeleted={() => { setOpenTask(null); setReloadSignal(s => s + 1) }}
            />
          </motion.div>
        </div>
      )}

      {showBannerEditor && homeroom && (
        <SmartboardBannerEditor
          homeroomId={homeroom.id}
          homeroomName={homeroom.name}
          banner={banner}
          onClose={() => setShowBannerEditor(false)}
          onSaved={(b) => { setBannerOverride(b); setShowBannerEditor(false) }}
        />
      )}
    </SmartboardLayout>
  )
}
