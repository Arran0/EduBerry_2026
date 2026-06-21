'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { MonitorPlay, BookOpen, Users, ArrowRight, Loader2, Sparkles } from 'lucide-react'
import SmartboardLayout from '@/components/SmartboardLayout'
import SmartboardWeeklyCalendar from '@/components/smartboard/SmartboardWeeklyCalendar'
import SmartboardTaskDetail from '@/components/smartboard/SmartboardTaskDetail'
import { useAuth } from '@/contexts/AuthContext'
import { fetchSmartboardContext, SmartboardContext, SmartboardTask } from '@/lib/smartboard'

export default function SmartboardDashboardPage() {
  const { profile, dataRefreshKey } = useAuth()
  const [ctx, setCtx] = useState<SmartboardContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [openTask, setOpenTask] = useState<SmartboardTask | null>(null)
  const [reloadSignal, setReloadSignal] = useState(0)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const data = await fetchSmartboardContext(profile.id)
    setCtx(data)
    setLoading(false)
  }, [profile])

  useEffect(() => { load() }, [load, dataRefreshKey])

  const homeroom = ctx?.homeroom
  const banner = homeroom?.smartboard_banner ?? null
  const bannerTitle = banner?.title?.trim() || homeroom?.name || 'Smart Board'
  const colorFrom = banner?.color_from || '#6366F1'
  const colorTo = banner?.color_to || '#7C3AED'

  return (
    <SmartboardLayout>
      {loading ? (
        <div className="text-center py-24">
          <Loader2 size={22} className="animate-spin mx-auto mb-3 text-indigo-400" />
          <p className="text-sm text-slate-500">Loading smart board…</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Customisable banner (title = homeroom name by default) ── */}
          <div
            className="relative overflow-hidden rounded-3xl shadow-lg"
            style={{ background: `linear-gradient(135deg, ${colorFrom}, ${colorTo})` }}
          >
            {banner?.image_url && (
              <img src={banner.image_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90" />
            )}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.18),transparent_60%)] pointer-events-none" />
            <div className="relative px-6 sm:px-10 py-10 sm:py-14">
              <div className="flex items-center gap-2 text-white/80 text-xs font-semibold uppercase tracking-widest mb-2">
                <MonitorPlay size={15} /> Smart Board
              </div>
              <h1
                className="font-display text-3xl sm:text-5xl font-bold text-white leading-tight"
                style={{ textShadow: '0 2px 8px rgba(0,0,0,0.25)' }}
              >
                {bannerTitle}
              </h1>
              {homeroom?.grade && homeroom?.section && (
                <p className="mt-2 text-white/80 text-sm font-medium">
                  Grade {homeroom.grade} · Section {homeroom.section}
                  {homeroom.academic_year ? ` · AY ${homeroom.academic_year}` : ''}
                </p>
              )}
            </div>
          </div>

          {!homeroom && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              This smart board account isn&apos;t linked to a homeroom yet. Ask an admin to assign it in the Homeroom Manager.
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ctx!.classrooms.map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Link
                      href={`/classrooms/${c.id}`}
                      className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-300 hover:shadow-md transition-all"
                    >
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold bg-gradient-to-br from-indigo-500 to-violet-600 flex-shrink-0 overflow-hidden">
                        {c.logo_url
                          ? <img src={c.logo_url} alt="" className="w-full h-full object-cover" />
                          : c.title.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{c.title}</p>
                        {c.subject && <p className="text-xs text-slate-400 truncate">{c.subject}</p>}
                      </div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </section>

          {/* ── Coming next (Rounds 5–6) ── */}
          <section className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/50 px-5 py-6">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles size={16} className="text-indigo-500" />
              <h2 className="font-display text-base font-bold text-slate-800">Coming next</h2>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">
              The homeroom attendance snapshot and the live top-3 leaderboard will appear here.
            </p>
          </section>
        </div>
      )}

      {openTask && (
        <SmartboardTaskDetail
          task={openTask}
          classrooms={ctx?.classrooms ?? []}
          onClose={() => setOpenTask(null)}
          onUpdated={() => setReloadSignal(s => s + 1)}
          onDeleted={() => { setOpenTask(null); setReloadSignal(s => s + 1) }}
        />
      )}
    </SmartboardLayout>
  )
}
