'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  BarChart3,
  Briefcase,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Users,
} from 'lucide-react'
import AnimatedNumber from '@/components/charts/AnimatedNumber'
import { fmtINR, fmtINRExact } from '@/lib/formatMoney'
import { AttendanceTally, HomeAttendanceCounts } from './AttendanceInfographicPanel'
import { SkeletonBar } from '../HomeCardSkeletons'
import { HomeFeesSummary } from './FeesInfographicPanel'
import { fetchCollectionYears, fetchMonthlyCollections, MonthlyCollections } from '@/lib/feeCollectionTimeline'

/* ──────────────────────────────────────────────────────────────────────────
   Data
   ────────────────────────────────────────────────────────────────────────── */

/** One fee head's slice of the year's ledger. Bus fee is one of these. */
export interface FeeHeadStat {
  id: string
  /** The fee_head ids this entry stands for — one, or several for the
   *  folded "Other fees". Payments are mapped onto heads through these. */
  memberIds: string[]
  name: string
  color: string
  collected: number
  outstanding: number
  todayCollection: number
  studentsWithDues: number
  /** Where "today's collection" and "students with dues" lead for this head. */
  todayHref: string
  duesHref: string
}

/** The fee ledger as one figure, broken down by head. */
export interface HomeFeeBreakdown {
  total: HomeFeesSummary
  heads: FeeHeadStat[]
}

const PRESENT = '#10b981'
const ABSENT = '#ef4444'
const IRREGULAR = '#f59e0b'
const EASE = [0.16, 1, 0.3, 1] as const

const countFmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const pctFmt = (n: number) => `${Math.round(n)}%`

/* ──────────────────────────────────────────────────────────────────────────
   Attendance — a dial per population
   ────────────────────────────────────────────────────────────────────────── */

const TICKS = 60

/**
 * One population's day as a dial.
 *
 * The ring is the present / absent / irregular split: gradient arcs with
 * rounded ends and a gap between them, winding on one after another from 12
 * o'clock while the whole ring turns into place. Around it a ring of ticks
 * lights up to the attendance rate, tick by tick, in step with the figure
 * counting up on the glass disc in the middle. Hovering a row lifts its arc,
 * dims the others and puts that row's count on the disc.
 */
function AttendanceDial({
  title, icon: Icon, tally, reportHref, hrefs, loading, delay,
}: {
  title: string
  icon: React.ElementType
  tally: AttendanceTally | null
  reportHref: string
  hrefs: { present: string; absent: string; exception: string }
  loading: boolean
  delay: number
}) {
  const reduceMotion = useReducedMotion()
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const present = tally?.present ?? 0
  const absent = tally?.absent ?? 0
  const exception = tally?.exception ?? 0
  const total = present + absent + exception
  const rate = total > 0 ? (present / total) * 100 : 0

  const size = 148
  const c = size / 2
  const stroke = 13
  const r = c - 16 - stroke / 2
  const C = 2 * Math.PI * r
  const rows = [
    { label: 'Present', value: present, color: PRESENT, light: '#6ee7b7', href: hrefs.present },
    { label: 'Absent', value: absent, color: ABSENT, light: '#fca5a5', href: hrefs.absent },
    { label: 'Irregular', value: exception, color: IRREGULAR, light: '#fcd34d', href: hrefs.exception },
  ]
  const nonZero = rows.filter(row => row.value > 0).length
  // Round caps reach stroke/2 past each end, so the drawn dash is shortened
  // by a stroke plus the visible gap; a lone segment is a closed ring.
  const trim = nonZero > 1 ? stroke + 5 : 0
  let acc = 0
  const arcs = rows.map(row => {
    const f = total > 0 ? row.value / total : 0
    const len = nonZero > 1 ? Math.max(f * C - trim, 0.01) : f * C
    const arc = { ...row, f, len, start: acc * C + trim / 2 }
    acc += f
    return arc
  })
  const litTicks = Math.round((rate / 100) * TICKS)

  return (
    <div className="lg-content flex-1 min-w-0 p-4 xl:p-5 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5">
          <Icon size={13} className="text-slate-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</span>
        </span>
        <Link
          href={reportHref}
          className="group/rl flex items-center gap-0.5 text-[11px] font-semibold text-sky-700 hover:text-sky-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 rounded"
        >
          View report <ChevronRight size={12} className="transition-transform group-hover/rl:translate-x-0.5" />
        </Link>
      </div>

      <div className="flex-1 flex items-center gap-4">
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
          <motion.svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={`${title} attendance today: ${present} present, ${absent} absent, ${exception} irregular out of ${total}.`}
            initial={reduceMotion ? false : { rotate: -150, opacity: 0, scale: 0.85 }}
            animate={{ rotate: -90, opacity: 1, scale: 1 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 70, damping: 15, delay }}
          >
            <defs>
              {rows.map((row, i) => (
                <linearGradient key={row.label} id={`${gid}-g${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={row.light} />
                  <stop offset="100%" stopColor={row.color} />
                </linearGradient>
              ))}
            </defs>

            {/* Tick ring — lights up to the rate. */}
            {Array.from({ length: TICKS }).map((_, i) => {
              const a = (i / TICKS) * Math.PI * 2
              const lit = !loading && i < litTicks
              const r1 = c - 4
              const r2 = c - (i % 5 === 0 ? 10 : 8)
              return (
                <motion.line
                  key={i}
                  x1={c + r1 * Math.cos(a)} y1={c + r1 * Math.sin(a)}
                  x2={c + r2 * Math.cos(a)} y2={c + r2 * Math.sin(a)}
                  strokeWidth={i % 5 === 0 ? 2 : 1.4}
                  strokeLinecap="round"
                  initial={{ stroke: '#e2e8f0' }}
                  animate={{ stroke: lit ? PRESENT : '#e2e8f0' }}
                  transition={{ duration: 0.25, delay: reduceMotion ? 0 : delay + 0.45 + i * (1.3 / TICKS) }}
                />
              )
            })}

            {/* Track. */}
            <circle cx={c} cy={c} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />

            {!loading && arcs.map((arc, i) => arc.f > 0 && (
              <motion.circle
                key={arc.label}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={`url(#${gid}-g${i})`}
                strokeLinecap={nonZero > 1 ? 'round' : 'butt'}
                strokeDashoffset={-arc.start}
                initial={{
                  strokeDasharray: reduceMotion ? `${arc.len} ${C}` : `0 ${C}`,
                  strokeWidth: stroke,
                  opacity: 1,
                }}
                animate={{
                  strokeDasharray: `${arc.len} ${C}`,
                  strokeWidth: hover === i ? stroke + 5 : stroke,
                  opacity: hover !== null && hover !== i ? 0.25 : 1,
                }}
                transition={{
                  strokeDasharray: reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.55 + arc.f * 0.9, delay: delay + 0.35 + (arc.start / C) * 1.1, ease: EASE },
                  strokeWidth: { type: 'spring', stiffness: 500, damping: 26 },
                  opacity: { duration: 0.18 },
                }}
                style={{ filter: hover === i ? `drop-shadow(0 0 6px ${arc.color}88)` : undefined }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(h => (h === i ? null : h))}
              />
            ))}
          </motion.svg>

          {/* The glass disc in the middle. */}
          <motion.div
            className="lg-disc absolute flex flex-col items-center justify-center text-center pointer-events-none"
            style={{ inset: 16 + stroke + 5 }}
            initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 14, delay: delay + 0.25 }}
          >
            {loading ? (
              <SkeletonBar w={40} h={16} cool />
            ) : total > 0 ? (
              <>
                <span className="font-display text-[1.45rem] font-black leading-none tabular-nums" style={{ color: hover !== null ? rows[hover].color : '#0f172a' }}>
                  {hover !== null
                    ? countFmt(rows[hover].value)
                    : <AnimatedNumber value={rate} format={pctFmt} delay={delay + 0.45} duration={1.4} />}
                </span>
                <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  {hover !== null ? rows[hover].label : 'present'}
                </span>
              </>
            ) : (
              <>
                <span className="font-display text-[1.3rem] font-black leading-none text-slate-400">—</span>
                <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 leading-tight">not marked</span>
              </>
            )}
          </motion.div>
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          {arcs.map((arc, i) => (
            <Link
              key={arc.label}
              href={arc.href}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(h => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(h => (h === i ? null : h))}
              className={`block rounded-xl px-2.5 py-1.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${hover === i ? 'bg-white shadow-sm -translate-y-px' : 'hover:bg-white/80'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                  <span className="w-2 h-2 rounded-full" style={{ background: `linear-gradient(135deg, ${arc.light}, ${arc.color})` }} />
                  {arc.label}
                </span>
                <span className="text-sm font-black text-slate-900 tabular-nums">
                  {loading ? <SkeletonBar w={22} h={12} cool /> : <AnimatedNumber value={arc.value} format={countFmt} delay={delay + 0.35 + i * 0.12} />}
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-slate-200/70 overflow-hidden">
                {!loading && (
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${arc.light}, ${arc.color})`, transformOrigin: 'left' }}
                    initial={reduceMotion ? false : { scaleX: 0 }}
                    animate={{ scaleX: arc.f }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.9, delay: delay + 0.5 + i * 0.12, ease: EASE }}
                  />
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   Fees — one ledger, broken down by head
   ────────────────────────────────────────────────────────────────────────── */

/** Fee-head colours — the validated categorical set in fixed order (blue,
 *  aqua, yellow, magenta, violet); bus fee is always orange and whatever folds
 *  into "Other fees" is a neutral. Checked with the dataviz palette validator:
 *  lightness band, chroma, colour-blind and normal-vision separation all pass
 *  in this order. Below 3:1 against white for three of them, so every chart
 *  here names its colours in visible text (legend, tooltip, table). */
export const FEE_HEAD_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#e87ba4', '#6250d6']
export const BUS_FEE_COLOR = '#eb6834'
export const OTHER_FEE_COLOR = '#8a909b'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** One of the two follow-ups: quiet, compact, neutral — the figure leads. */
function FeeMiniButton({
  href, icon: Icon, value, format, label, loading, title, delay, dot,
}: {
  /** The selected fee head's colour, marked on the icon. */
  dot?: string
  href: string
  icon: React.ElementType
  value: number
  format: (n: number) => string
  label: string
  loading: boolean
  title?: string
  delay: number
}) {
  return (
    <Link href={href} title={title} className="fee-mini group/fm">
      <span className="fee-mini-icon relative">
        <Icon size={14} />
        {dot && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white" style={{ background: dot }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-slate-900 tabular-nums leading-none">
          {loading ? <SkeletonBar w={48} h={13} cool /> : <AnimatedNumber value={value} format={format} delay={delay} />}
        </span>
        <span className="block text-[10.5px] font-medium text-slate-500 mt-1 truncate">{label}</span>
      </span>
      <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all group-hover/fm:text-slate-600 group-hover/fm:translate-x-0.5" />
    </Link>
  )
}

interface ChartSeries { id: string; name: string; color: string; memberIds: string[] }

/** A rounded-up axis maximum on a fine ladder, so the tallest month fills
 *  most of the plot rather than stopping halfway up it. */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/**
 * The year's collection month by month, Jan → Dec, stacked by fee head in
 * the same colours as the bar above (the chips above are its legend). Steps
 * between years with the switcher in its header. Hovering a month reads it
 * out; selecting a head above dims every other head here too.
 */
function MonthlyCollectionChart({
  heads, activeId,
}: {
  heads: FeeHeadStat[]
  activeId: string | null
}) {
  const reduceMotion = useReducedMotion()
  const thisYear = new Date().getFullYear()
  const thisMonth = new Date().getMonth()
  const [years, setYears] = useState<number[]>([thisYear])
  const [year, setYear] = useState(thisYear)
  const [data, setData] = useState<MonthlyCollections | null>(null)
  const [failed, setFailed] = useState(false)
  const [hoverMonth, setHoverMonth] = useState<number | null>(null)
  const cache = useRef(new Map<number, MonthlyCollections>())

  useEffect(() => {
    fetchCollectionYears().then(setYears).catch(err => console.error('Failed to load collection years:', err))
  }, [])

  useEffect(() => {
    let cancelled = false
    const hit = cache.current.get(year)
    if (hit) { setData(hit); setFailed(false); return }
    setData(null)
    setFailed(false)
    fetchMonthlyCollections(year)
      .then(d => { cache.current.set(year, d); if (!cancelled) setData(d) })
      .catch(err => {
        console.error('Failed to load monthly collections:', err)
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [year])

  // The chart's series: the overview's heads, plus bus fee and "Other fees"
  // if this year's ledger doesn't carry them but an earlier year's payments do.
  const series: ChartSeries[] = useMemo(() => {
    const list: ChartSeries[] = heads.map(h => ({ id: h.id, name: h.name, color: h.color, memberIds: h.memberIds }))
    if (!list.some(s => s.id === '__other')) {
      const busAt = list.findIndex(s => s.id === '__bus')
      const other = { id: '__other', name: 'Other fees', color: OTHER_FEE_COLOR, memberIds: [] }
      if (busAt === -1) list.push(other)
      else list.splice(busAt, 0, other)
    }
    if (!list.some(s => s.id === '__bus')) list.push({ id: '__bus', name: 'Bus fee', color: BUS_FEE_COLOR, memberIds: ['__bus'] })
    return list
  }, [heads])

  const months = useMemo(() => {
    if (!data) return null
    const owner = new Map<string, string>()
    series.forEach(s => s.memberIds.forEach(m => owner.set(m, s.id)))
    return data.map(raw => {
      const by = new Map<string, number>()
      for (const [head, amt] of Object.entries(raw)) {
        const sid = owner.get(head) ?? '__other'
        by.set(sid, (by.get(sid) ?? 0) + amt)
      }
      const segs = series.map(s => ({ series: s, value: by.get(s.id) ?? 0 })).filter(x => x.value > 0)
      return { segs, total: segs.reduce((n, x) => n + x.value, 0) }
    })
  }, [data, series])

  const yearTotal = months?.reduce((n, m) => n + m.total, 0) ?? 0
  const activeSeries = series.find(s => s.id === activeId) ?? null
  const shownTotal = activeSeries && months
    ? months.reduce((n, m) => n + (m.segs.find(x => x.series.id === activeSeries.id)?.value ?? 0), 0)
    : yearTotal
  // Series drawn here that have no chip above (an earlier year's bus fee or
  // folded heads) — named in a small legend of their own.
  const extras = months
    ? series.filter(s => !heads.some(h => h.id === s.id) && months.some(m => m.segs.some(x => x.series.id === s.id)))
    : []
  const peak = months ? Math.max(0, ...months.map(m => m.total)) : 0
  const top = niceMax(peak)
  const idx = years.indexOf(year)
  const canPrev = idx > 0
  const canNext = idx !== -1 && idx < years.length - 1
  const hovered = hoverMonth !== null && months ? months[hoverMonth] : null

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Monthly collection</p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {months
              ? <><AnimatedNumber value={shownTotal} format={fmtINR} className="font-bold text-slate-800" /> collected in {year}{activeSeries ? ` · ${activeSeries.name}` : ''}</>
              : <SkeletonBar w={120} h={10} cool />}
          </p>
          {extras.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-x-3 text-[10.5px] text-slate-500">
              {extras.map(x => (
                <span key={x.id} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-[2px]" style={{ background: x.color }} />{x.name}
                </span>
              ))}
            </p>
          )}
        </div>
        {/* Year switcher — a small glass capsule. */}
        <div className="lg-pill flex items-center h-8 px-1 flex-shrink-0" role="group" aria-label="Year">
          <button
            type="button"
            onClick={() => canPrev && setYear(years[idx - 1])}
            disabled={!canPrev}
            aria-label="Previous year"
            className="w-6 h-6 rounded-full flex items-center justify-center text-slate-600 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="relative w-12 h-5 overflow-hidden text-center">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={year}
                className="absolute inset-0 text-[12.5px] font-bold text-slate-800 tabular-nums leading-5"
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
                aria-live="polite"
              >
                {year}
              </motion.span>
            </AnimatePresence>
          </span>
          <button
            type="button"
            onClick={() => canNext && setYear(years[idx + 1])}
            disabled={!canNext}
            aria-label="Next year"
            className="w-6 h-6 rounded-full flex items-center justify-center text-slate-600 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* The plot: a recessive axis at left, twelve stacked columns. */}
      <div className="relative mt-3 flex-1 min-h-[150px] flex" onMouseLeave={() => setHoverMonth(null)}>
        <div className="relative w-11 flex-shrink-0 text-[10px] text-slate-400 tabular-nums" aria-hidden>
          <div className="absolute inset-x-0 top-0 bottom-5">
            {[1, 0.5, 0].map(f => (
              <span key={f} className="absolute right-2 -translate-y-1/2 leading-none" style={{ top: `${(1 - f) * 100}%` }}>
                {months && peak > 0 ? fmtINR(top * f) : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="relative flex-1 min-w-0">
          {/* Gridlines. */}
          <div className="absolute inset-x-0 top-0 bottom-5 pointer-events-none" aria-hidden>
            {[0, 0.5, 1].map(f => (
              <span key={f} className={`absolute inset-x-0 border-t ${f === 1 ? 'border-slate-300' : 'border-dashed border-slate-200'}`} style={{ top: `${f * 100}%` }} />
            ))}
          </div>

          <div className="absolute inset-0 grid grid-cols-12 gap-1">
            {MONTHS.map((label, m) => {
              const month = months?.[m]
              const future = year === thisYear && m > thisMonth
              const isHover = hoverMonth === m
              return (
                <div
                  key={m}
                  className={`relative flex flex-col items-center rounded-lg transition-colors ${isHover ? 'bg-slate-100/80' : ''}`}
                  onMouseEnter={() => setHoverMonth(m)}
                >
                  <div className="relative flex-1 w-full flex justify-center pb-5">
                    <div className="relative h-full w-full max-w-[26px]">
                      {!months ? (
                        !failed && (
                          <div className="absolute inset-x-0 bottom-0 rounded-t-[4px] overflow-hidden" style={{ height: `${25 + ((m * 37) % 50)}%` }}>
                            <SkeletonBar w="100%" h="100%" cool rounded={false} delay={m * 0.04} />
                          </div>
                        )
                      ) : month && month.total > 0 ? (
                        <motion.div
                          key={`${year}-${m}`}
                          className="absolute inset-x-0 bottom-0 flex flex-col-reverse gap-[2px]"
                          style={{ height: `${(month.total / top) * 100}%`, transformOrigin: 'bottom' }}
                          initial={reduceMotion ? false : { scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 170, damping: 22, delay: 0.1 + m * 0.045 }}
                        >
                          {month.segs.map((seg, i) => (
                            <span
                              key={seg.series.id}
                              className={`block w-full min-h-[2px] transition-opacity duration-200 ${i === month.segs.length - 1 ? 'rounded-t-[4px]' : ''}`}
                              style={{
                                flexGrow: seg.value,
                                flexBasis: 0,
                                background: seg.series.color,
                                opacity: activeId && seg.series.id !== activeId ? 0.22 : 1,
                              }}
                            />
                          ))}
                        </motion.div>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={`absolute bottom-0 h-4 text-[10px] leading-4 tabular-nums ${year === thisYear && m === thisMonth ? 'font-bold text-slate-900' : future ? 'text-slate-300' : 'font-medium text-slate-500'}`}
                  >
                    {label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Month read-out. */}
          <AnimatePresence>
            {hovered && hoverMonth !== null && (
              <motion.div
                key="tip"
                role="status"
                className="lg-tooltip absolute top-0 z-20 pointer-events-none min-w-[170px]"
                initial={{ opacity: 0, y: 4, x: '-50%', left: `${((hoverMonth + 0.5) / 12) * 100}%` }}
                animate={{ opacity: 1, y: 0, x: '-50%', left: `${Math.min(Math.max((hoverMonth + 0.5) / 12, 0.14), 0.86) * 100}%` }}
                exit={{ opacity: 0, y: 4, x: '-50%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              >
                <p className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="font-bold text-slate-900">{MONTHS_LONG[hoverMonth]} {year}</span>
                  <span className="font-bold text-slate-900 tabular-nums">{fmtINRExact(hovered.total)}</span>
                </p>
                {hovered.segs.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    {[...hovered.segs].reverse().map(seg => (
                      <p key={seg.series.id} className="flex items-center justify-between gap-3 text-[10.5px] tabular-nums">
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <span className="w-2 h-2 rounded-sm" style={{ background: seg.series.color }} />
                          {seg.series.name}
                        </span>
                        <span className="font-semibold text-slate-800">{fmtINR(seg.value)}</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-0.5 text-[10.5px] text-slate-500">Nothing collected</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {months && yearTotal === 0 && (
            <p className="absolute inset-x-0 top-1/3 text-center text-xs font-medium text-slate-400">No collections recorded in {year}</p>
          )}
          {failed && (
            <p className="absolute inset-x-0 top-1/3 text-center text-xs font-medium text-slate-400">Couldn&apos;t load {year}&apos;s collections</p>
          )}
        </div>
      </div>

      {/* The same figures as a table, for screen readers. */}
      {months && (
        <table className="sr-only">
          <caption>Fee collection by month, {year}</caption>
          <thead><tr><th>Month</th><th>Collected</th></tr></thead>
          <tbody>
            {months.map((mo, m) => (
              <tr key={m}><td>{MONTHS_LONG[m]}</td><td>{fmtINRExact(mo.total)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface BarPiece {
  head: FeeHeadStat
  kind: 'collected' | 'outstanding'
  value: number
  /** Share of the year's billing, 0–1. */
  share: number
}

/**
 * The fee side of the overview, in two halves.
 *
 * Top: the year's collected figure and rate, the two follow-ups (today's
 * collection, students with dues) as quiet buttons beside it, and one bar —
 * collected on the left, owed on the right, banded by fee head — with the
 * heads named in a row of chips under it. Pointing at a band or a chip
 * selects that head: the headline, the rate and both follow-ups glide to its
 * figures. A click on a chip pins it (the touch-screen way in).
 *
 * Bottom: the month-by-month collection chart for a calendar year.
 */
function FeeLedger({ fees, loading }: {
  fees: HomeFeeBreakdown | null
  loading: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [barHover, setBarHover] = useState(false)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const activeId = hoverId ?? pinnedId
  const heads = useMemo(() => fees?.heads ?? [], [fees])
  const active = heads.find(h => h.id === activeId) ?? null

  const total = fees?.total
  const billed = (total?.collected ?? 0) + (total?.outstanding ?? 0)
  const rate = billed > 0 ? ((total?.collected ?? 0) / billed) * 100 : 0

  const pieces: BarPiece[] = useMemo(() => {
    if (billed <= 0) return []
    const collected = heads
      .filter(h => h.collected > 0)
      .map(h => ({ head: h, kind: 'collected' as const, value: h.collected, share: h.collected / billed }))
    const outstanding = heads
      .filter(h => h.outstanding > 0)
      .map(h => ({ head: h, kind: 'outstanding' as const, value: h.outstanding, share: h.outstanding / billed }))
    return [...collected, ...outstanding]
  }, [heads, billed])

  // The tooltip's anchor: the middle of the hovered head's widest band, kept
  // off the ends so the one-line read-out never runs past the card.
  const tooltipAt = useMemo(() => {
    if (!active) return null
    let acc = 0
    let best: { mid: number; share: number } | null = null
    for (const p of pieces) {
      if (p.head.id === active.id && (!best || p.share > best.share)) best = { mid: acc + p.share / 2, share: p.share }
      acc += p.share
    }
    return best ? Math.min(Math.max(best.mid, 0.3), 0.7) : null
  }, [active, pieces])

  const shown = active
  const shownCollected = shown ? shown.collected : (total?.collected ?? 0)
  const shownOutstanding = shown ? shown.outstanding : (total?.outstanding ?? 0)
  const shownBilled = shownCollected + shownOutstanding
  const shownRate = shownBilled > 0 ? (shownCollected / shownBilled) * 100 : 0
  const shownToday = shown ? shown.todayCollection : (total?.todayCollection ?? 0)
  const shownDues = shown ? shown.studentsWithDues : (total?.studentsWithDues ?? 0)
  const todayHref = shown?.todayHref ?? '/more/fees?section=collection'
  const duesHref = shown?.duesHref ?? '/more/fees?section=issued&filter=outstanding'

  let offset = 0

  return (
    <div className="lg-content p-4 xl:p-5 min-w-0 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5">
          <CreditCard size={13} className="text-slate-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Fees · this year</span>
        </span>
        <Link
          href="/more/fees"
          className="group/rl flex items-center gap-0.5 text-[11px] font-semibold text-sky-700 hover:text-sky-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 rounded"
        >
          Fee Manager <ChevronRight size={12} className="transition-transform group-hover/rl:translate-x-0.5" />
        </Link>
      </div>

      {/* ── Top half ── */}
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="h-4 mb-1 relative overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={shown?.id ?? 'all'}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 truncate"
              >
                {shown && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: shown.color }} />}
                {shown ? `${shown.name} · collected` : 'Collected · all fee heads'}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="flex items-baseline gap-2.5">
            <p className="font-display text-[1.9rem] xl:text-[2.1rem] font-black leading-none text-slate-900 tabular-nums" title={fmtINRExact(shownCollected)}>
              {loading ? <SkeletonBar w={130} h={28} cool /> : <AnimatedNumber value={shownCollected} format={fmtINR} delay={0.25} />}
            </p>
            {!loading && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-bold tabular-nums">
                <AnimatedNumber value={shownRate} format={pctFmt} delay={0.4} />
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {loading ? <SkeletonBar w={160} h={10} cool /> : (
              <>
                of <AnimatedNumber value={shownBilled} format={fmtINR} delay={0.3} className="font-semibold text-slate-700" /> billed ·{' '}
                <AnimatedNumber value={shownOutstanding} format={fmtINR} delay={0.35} className="font-semibold text-amber-700" /> outstanding
              </>
            )}
          </p>
        </div>
        <div className="w-[13.5rem] flex-shrink-0 space-y-1.5">
          <FeeMiniButton
            href={todayHref}
            icon={CalendarCheck}
            value={shownToday}
            format={fmtINR}
            label="Today's collection"
            dot={shown?.color}
            loading={loading}
            delay={0.45}
            title={`Today's collection: ${fmtINRExact(shownToday)}`}
          />
          <FeeMiniButton
            href={duesHref}
            icon={Users}
            value={shownDues}
            format={countFmt}
            label="Students with dues"
            dot={shown?.color}
            loading={loading}
            delay={0.5}
          />
        </div>
      </div>

      {/* The bar. */}
      <div
        className="relative mt-4"
        onMouseEnter={() => setBarHover(true)}
        onMouseLeave={() => { setHoverId(null); setBarHover(false) }}
      >
        <div className="relative h-3.5 rounded-full bg-slate-200/70 shadow-[inset_0_1px_2px_rgba(15,23,42,0.12)]">
          {loading ? (
            <div className="absolute inset-0 rounded-full overflow-hidden"><SkeletonBar w="100%" h="100%" cool /></div>
          ) : billed <= 0 ? (
            <p className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-500">Nothing billed yet this year</p>
          ) : (
            <motion.div
              className="absolute inset-0 flex gap-[2px] rounded-full overflow-hidden"
              initial={reduceMotion ? false : { clipPath: 'inset(0 100% 0 0 round 9999px)' }}
              animate={{ clipPath: 'inset(0 0% 0 0 round 9999px)' }}
              transition={reduceMotion ? { duration: 0 } : { duration: 1.3, delay: 0.2, ease: [0.65, 0, 0.35, 1] }}
            >
              {pieces.map(p => {
                const left = offset
                offset += p.share
                const dim = activeId !== null && p.head.id !== activeId
                const lift = activeId !== null && p.head.id === activeId
                return (
                  <motion.button
                    key={`${p.kind}-${p.head.id}`}
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    onMouseEnter={() => setHoverId(p.head.id)}
                    onClick={() => setPinnedId(id => (id === p.head.id ? null : p.head.id))}
                    className={`relative h-full min-w-0 ${p.kind === 'outstanding' ? 'fee-stripes' : 'fee-solid'}`}
                    style={{ flex: `${p.share} 1 0%`, ['--fee-c' as string]: p.head.color }}
                    initial={reduceMotion ? false : { opacity: 0, scaleY: 0.4 }}
                    animate={{ opacity: dim ? 0.25 : 1, scaleY: lift ? 1.35 : 1 }}
                    transition={{
                      opacity: { duration: 0.2 },
                      scaleY: reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 380, damping: 22, delay: lift || dim ? 0 : 0.25 + left * 1.2 },
                    }}
                    title={`${p.head.name} · ${p.kind}: ${fmtINRExact(p.value)}`}
                  />
                )
              })}
              {!reduceMotion && (
                <span
                  aria-hidden
                  className="fee-glint absolute inset-y-0 left-0 pointer-events-none"
                  style={{ width: `${rate}%` }}
                />
              )}
            </motion.div>
          )}

          {/* The seam between paid and owed — the collection rate. */}
          {!loading && billed > 0 && (
            <motion.div
              aria-hidden
              className="absolute -top-1 -bottom-1 w-[3px] -ml-[1.5px] rounded-full bg-slate-900 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] z-10 pointer-events-none"
              initial={reduceMotion ? false : { left: '0%', opacity: 0 }}
              animate={{ left: `${rate}%`, opacity: 1 }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 60, damping: 16, delay: 0.5 }}
            />
          )}
        </div>

        {/* Read-out for a band pointed at — under the bar, over the chips. */}
        <AnimatePresence>
          {active && barHover && tooltipAt !== null && (
            <motion.div
              key="tip"
              role="status"
              className="lg-tooltip absolute top-full mt-2 z-20 whitespace-nowrap pointer-events-none flex items-center gap-2 text-[11px] tabular-nums"
              initial={{ opacity: 0, x: '-50%', y: -4, scale: 0.96, left: `${tooltipAt * 100}%` }}
              animate={{ opacity: 1, x: '-50%', y: 0, scale: 1, left: `${tooltipAt * 100}%` }}
              exit={{ opacity: 0, x: '-50%', y: -4, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: active.color }} />
              <span className="font-bold text-slate-900">{active.name}</span>
              <span className="text-slate-300">|</span>
              <span className="font-bold text-emerald-700">{fmtINRExact(active.collected)}</span>
              <span className="text-slate-500">collected</span>
              <span className="text-slate-300">·</span>
              <span className="font-bold text-amber-700">{fmtINRExact(active.outstanding)}</span>
              <span className="text-slate-500">outstanding</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Chips — the colours named (for the bar and the chart below), and the
          keyboard/touch way to select a head. */}
      {!loading && heads.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Fee heads">
          {heads.map((h, i) => {
            const billedH = h.collected + h.outstanding
            const rateH = billedH > 0 ? Math.round((h.collected / billedH) * 100) : 0
            const isActive = activeId === h.id
            return (
              <motion.button
                key={h.id}
                type="button"
                aria-pressed={pinnedId === h.id}
                onMouseEnter={() => setHoverId(h.id)}
                onMouseLeave={() => setHoverId(null)}
                onFocus={() => setHoverId(h.id)}
                onBlur={() => setHoverId(null)}
                onClick={() => setPinnedId(id => (id === h.id ? null : h.id))}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: activeId !== null && !isActive ? 0.55 : 1, y: 0 }}
                transition={{ duration: 0.3, delay: reduceMotion || activeId !== null ? 0 : 0.7 + i * 0.05 }}
                className={`flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${isActive ? 'bg-white border-slate-300 text-slate-900 shadow-sm' : 'bg-slate-50/80 border-slate-200 text-slate-600 hover:bg-white'} ${pinnedId === h.id ? 'ring-1 ring-slate-400' : ''}`}
              >
                <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: h.color }} />
                {h.name}
                <span className="tabular-nums text-slate-500 font-medium">{rateH}%</span>
              </motion.button>
            )
          })}
        </div>
      )}

      {/* ── Bottom half ── */}
      <div className="mt-4 pt-4 border-t border-slate-200/80 flex-1 min-h-0 flex flex-col">
        <MonthlyCollectionChart heads={heads} activeId={activeId} />
      </div>
    </div>
  )
}
/* ──────────────────────────────────────────────────────────────────────────
   The panel
   ────────────────────────────────────────────────────────────────────────── */

export interface SchoolOverviewPanelProps {
  attendance: { counts: HomeAttendanceCounts | null; subtitle?: string } | null
  /** The whole fee ledger, bus fee included as one of its heads. Null while
   *  it loads. */
  fees: HomeFeeBreakdown | null
  /** Which halves this account is entitled to. */
  showAttendance: boolean
  showFees: boolean
  /** Today, pre-formatted by the page so the whole page agrees on the date. */
  today: string
}

/**
 * The admin's standing statistics as one Liquid Glass panel: today's
 * attendance as two dials in the narrow column, the year's fees in the wide
 * one.
 *
 * The sheet is glass — a lensing surface with a specular rim and a highlight
 * that follows the pointer, over ambient colour — and the dials and the
 * ledger sit on it as solid content cards, so nothing is read off the glass.
 * Fees are one ledger, bus fee simply one of its heads, and get the larger
 * share of the width: the ledger is the half with the most to say.
 */
export default function SchoolOverviewPanel({
  attendance, fees, showAttendance, showFees, today,
}: SchoolOverviewPanelProps) {
  const reduceMotion = useReducedMotion()
  const attendanceLoading = attendance !== null && attendance.counts === null
  const both = showAttendance && showFees

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    el.style.setProperty('--lg-x', `${e.clientX - r.left}px`)
    el.style.setProperty('--lg-y', `${e.clientY - r.top}px`)
  }

  return (
    <div className="relative">
      {/* Ambient light for the glass to bend. */}
      <div aria-hidden className="lg-ambient lg-ambient-overview">
        <span style={{ color: '#10b981' }} />
        <span style={{ color: '#0ea5e9' }} />
        <span style={{ color: '#f59e0b' }} />
      </div>

      <motion.div
        className="lg-deck lg-panel"
        onPointerMove={onPointerMove}
        initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.7, ease: EASE }}
      >
        {/* Header — sits straight on the glass. */}
        <div className="relative z-[3] flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="icon-chip w-9 h-9 flex-shrink-0 bg-gradient-to-br from-emerald-400 to-teal-500">
              <BarChart3 size={16} className="relative z-10 text-white drop-shadow-sm" />
            </div>
            <div className="min-w-0">
              <p className="eyebrow text-slate-500 mb-1">Today</p>
              <h2 className="font-display text-[1.3rem] font-bold leading-none headline text-slate-900 truncate">
                School Overview
              </h2>
            </div>
          </div>
          <div className="lg-pill flex items-center gap-2.5 h-8 px-3 flex-shrink-0">
            {attendance?.subtitle && (
              <span className="hidden xl:inline text-[11px] font-medium text-slate-600 truncate max-w-[16rem]">
                {attendance.subtitle}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[10.5px] font-bold text-emerald-700">Live</span>
            </span>
            <span className="w-px h-3.5 bg-slate-300" />
            <span className="text-xs font-semibold text-slate-600 tabular-nums">{today}</span>
          </div>
        </div>

        <div className={`relative z-[3] grid grid-cols-1 gap-3 px-3 pb-3 ${both ? 'xl:grid-cols-12' : ''}`}>
          {showAttendance && (
            <section
              className={`min-w-0 flex flex-col lg:flex-row gap-3 ${both ? 'xl:col-span-4 xl:flex-col' : ''}`}
              aria-label="Attendance today"
            >
              <AttendanceDial
                loading={attendanceLoading}
                icon={Users}
                title="Students"
                tally={attendance?.counts?.students ?? null}
                reportHref="/more/attendance"
                hrefs={{
                  present: '/more/attendance#student-present',
                  absent: '/more/attendance#student-absent',
                  exception: '/more/attendance#student-irregular',
                }}
                delay={0.1}
              />
              <AttendanceDial
                loading={attendanceLoading}
                icon={Briefcase}
                title="Staff"
                tally={attendance?.counts?.staff ?? null}
                reportHref="/more/staff-attendance"
                hrefs={{
                  present: '/more/staff-attendance#staff-present',
                  absent: '/more/staff-attendance#staff-absent',
                  exception: '/more/staff-attendance#staff-exceptions',
                }}
                delay={0.3}
              />
            </section>
          )}

          {showFees && (
            <section aria-label="Fee collection" className={`min-w-0 ${both ? 'xl:col-span-8' : ''}`}>
              <FeeLedger fees={fees} loading={fees === null} />
            </section>
          )}
        </div>
      </motion.div>
    </div>
  )
}
