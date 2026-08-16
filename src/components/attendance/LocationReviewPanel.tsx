'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  HelpCircle, Check, X, Loader2, Satellite, MapPin, ChevronDown, Activity,
} from 'lucide-react'
import {
  PendingReviewRow,
  LocationAttemptStats,
  fetchPendingReviews,
  resolveAttendanceReview,
  fetchLocationAttempts,
  summariseLocationAttempts,
} from '@/lib/attendance'

interface Props {
  refreshKey?: number
  onChanged?: () => void
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/** Last 30 days, as the diagnostics window. */
function diagnosticsRange(): { start: string; end: string } {
  const end = new Date()
  const start = new Date(end.getTime() - 29 * 86400000)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

/**
 * The coordinator's side of the coarse-reading problem.
 *
 * When a check-in lands on a reading too imprecise to place the staff member
 * inside or outside the fence, it is recorded at its real time and queued here.
 * That is the deliberate trade: the ambiguity is carried by whoever can actually
 * resolve it — someone who knows whether that person was in the building — and
 * not by the staff member, who previously just had their check-in refused.
 *
 * The diagnostics underneath exist so the accuracy threshold is set from
 * evidence. If the same handful of names appear week after week, the answer is
 * a device or a fence problem, not a threshold to keep nudging.
 */
export default function LocationReviewPanel({ refreshKey, onChanged }: Props) {
  const [rows, setRows] = useState<PendingReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)
  const [stats, setStats] = useState<LocationAttemptStats | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchPendingReviews())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  const loadDiagnostics = useCallback(async () => {
    if (stats) return
    const { start, end } = diagnosticsRange()
    setStats(summariseLocationAttempts(await fetchLocationAttempts(start, end)))
  }, [stats])

  useEffect(() => { if (showDiagnostics) loadDiagnostics() }, [showDiagnostics, loadDiagnostics])

  const resolve = async (row: PendingReviewRow, approve: boolean) => {
    const key = `${row.staff_id}:${row.date}`
    setResolving(key)
    setError(null)
    const ok = await resolveAttendanceReview(row.staff_id, row.date, approve)
    setResolving(null)
    if (!ok) {
      setError('Could not save that decision. Please try again.')
      return
    }
    setRows(prev => prev.filter(r => `${r.staff_id}:${r.date}` !== key))
    // Diagnostics counts change with each decision — drop the cache so the
    // next open recomputes rather than showing a stale snapshot.
    setStats(null)
    onChanged?.()
  }

  return (
    <section className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden">
      <div
        className="border-b border-black/10 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2"
        style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
      >
        <h2 className="flex items-center gap-2 text-sm font-bold text-white min-w-0">
          <HelpCircle size={15} className="flex-shrink-0" style={{ color: 'var(--page-accent)' }} />
          <span className="truncate">Location Confirmations</span>
        </h2>
        {rows.length > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/20 text-[11px] font-bold text-white tabular-nums flex-shrink-0">
            {rows.length}
          </span>
        )}
      </div>

      <div className="p-3 sm:p-4 space-y-3">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-[#A1A1AA]">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-[#A1A1AA]">
            <Check size={12} className="text-emerald-500" /> Nothing to confirm — every check-in placed
            cleanly inside or outside its zone.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-[#71717A] leading-relaxed">
              These check-ins were recorded, but the device could only report an approximate position —
              too imprecise to confirm the staff member was on site. Confirm if they were present.
              Rejecting marks the day absent and keeps the recorded times.
            </p>

            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {rows.map(row => {
                  const key = `${row.staff_id}:${row.date}`
                  const busy = resolving === key
                  return (
                    <motion.li
                      key={key}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 bg-[#FAFAFA] border border-[#E4E4E7] rounded-xl">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-[#18181B] truncate">
                            {row.staff?.full_name ?? 'Unknown staff'}
                          </p>
                          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[#71717A] mt-0.5">
                            <span>{formatDate(row.date)}</span>
                            <span className="flex items-center gap-1">
                              <MapPin size={10} /> in {formatTime(row.check_in_time)}
                            </span>
                            {row.check_out_time && <span>out {formatTime(row.check_out_time)}</span>}
                            {row.check_in_accuracy != null && (
                              <span className="flex items-center gap-1 font-semibold text-amber-600">
                                <Satellite size={10} /> ±{Math.round(row.check_in_accuracy)}m
                              </span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => resolve(row, true)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors"
                          >
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            Confirm
                          </button>
                          <button
                            onClick={() => resolve(row, false)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#52525B] bg-white border border-[#D4D4D8] hover:bg-[#F5F5F5] disabled:opacity-50 rounded-lg transition-colors"
                          >
                            <X size={12} /> Reject
                          </button>
                        </div>
                      </div>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* ── Diagnostics ── */}
        <div className="pt-2 border-t border-[#F0F0F0]">
          <button
            onClick={() => setShowDiagnostics(v => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-[#71717A] hover:text-[#18181B] transition-colors"
          >
            <Activity size={12} />
            Location diagnostics (30 days)
            <ChevronDown size={12} className={`transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence initial={false}>
            {showDiagnostics && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.24 }}
                className="overflow-hidden"
              >
                {!stats ? (
                  <p className="flex items-center gap-2 text-xs text-[#A1A1AA] pt-3">
                    <Loader2 size={12} className="animate-spin" /> Reading attempt log…
                  </p>
                ) : stats.total === 0 ? (
                  <p className="text-xs text-[#A1A1AA] pt-3">
                    No attempts logged yet. Data starts collecting from the first check-in after this
                    update is deployed.
                  </p>
                ) : (
                  <div className="pt-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { label: 'Attempts', value: stats.total },
                        { label: 'Sent to review', value: stats.uncertain },
                        { label: 'Refused', value: stats.refused },
                        { label: 'No fix at all', value: stats.noFix },
                      ].map(s => (
                        <div key={s.label} className="px-2.5 py-2 bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg">
                          <p className="text-lg font-bold text-[#18181B] tabular-nums leading-none">{s.value}</p>
                          <p className="text-[10px] text-[#A1A1AA] mt-1">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    <p className="text-[11px] text-[#71717A]">
                      Typical accuracy <span className="font-bold text-[#18181B]">±{stats.medianAccuracyM ?? '—'}m</span>
                      {' · '}worst 5% of readings <span className="font-bold text-[#18181B]">±{stats.p95AccuracyM ?? '—'}m</span>
                      {' · '}<span className="font-bold text-[#18181B]">{stats.coarse}</span> approximate locks.
                      {' '}The threshold should sit above the typical figure and below the tail — set it
                      under the tail and those readings all land in this queue.
                    </p>

                    {stats.worstAffected.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA] mb-1.5">
                          Most affected staff
                        </p>
                        <ul className="space-y-1">
                          {stats.worstAffected.map(s => (
                            <li key={s.staffId} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-[#52525B] truncate">{s.name}</span>
                              <span className="text-[#A1A1AA] tabular-nums flex-shrink-0">
                                {s.problemCount} of {s.attempts}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="text-[10px] text-[#A1A1AA] mt-1.5 leading-relaxed">
                          The same names recurring points at a device or a fence that needs attention —
                          not a threshold to keep adjusting.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}
