'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  TrendingUp, TrendingDown, Minus, Star, ClipboardList, BarChart3, Trophy,
  ChevronLeft, ChevronRight, ChevronDown, Search, Users, X, Check, CalendarDays, Loader2,
} from 'lucide-react'
import { ClassroomWithDetails, ClassroomStudentLite, fetchStudentRoster } from '@/lib/classrooms'
import { UserRole, isStaffRole } from '@/lib/supabase'
import {
  EduMonthSummary, EduLeaderboardRow, EduLeaderboardSort, AssessmentTrendRow,
  fetchClassroomEduMonthSummary, fetchClassroomEduLeaderboard, fetchClassroomAssessmentTrend,
} from '@/lib/gamification'
import LineChart, { ChartSeries } from '@/components/charts/LineChart'
import Avatar from '@/components/Avatar'
import { AnalysisSkeleton, AnalysisLeaderboardSkeleton, ANALYSIS_CARD as CARD } from '@/components/classrooms/ClassroomSkeletons'

interface AnalysisTabProps {
  classroomId: string
  userId: string
  userRole: UserRole
  classroom: ClassroomWithDetails
}

const AVG_COLOR = '#10b981'      // emerald — class average
const TOP_COLOR = '#f59e0b'      // amber — the month's top scorer
const FOCUS_COLOR = '#6366f1'    // indigo — the student picked above
const EXAM_AVG_COLOR = '#94a3b8' // slate — class average on the assessment chart

const PAGE = 10

// Month keys are first-of-month 'YYYY-MM-DD' strings. Built from the parts, not
// `new Date(str)`, which reads them as UTC midnight and can land a day early.
function monthDate(m: string): Date {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1)
}
const shortMonth = (m: string) => monthDate(m).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
const longMonth = (m: string) => monthDate(m).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

export default function AnalysisTab({ classroomId, userRole }: AnalysisTabProps) {
  const isStaff = isStaffRole(userRole)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [roster, setRoster] = useState<ClassroomStudentLite[]>([])
  const [summary, setSummary] = useState<EduMonthSummary[]>([])
  const [trend, setTrend] = useState<AssessmentTrendRow[]>([])
  const [selectedStudent, setSelectedStudent] = useState<string>('')
  const [month, setMonth] = useState<string>('')

  // Per-student results, so flipping between students already looked at is
  // instant. '' is the whole class.
  const cache = useRef(new Map<string, { summary: EduMonthSummary[]; trend: AssessmentTrendRow[] }>())

  useEffect(() => {
    if (!isStaff) return
    let active = true
    cache.current.clear()
    setLoading(true)
    setSelectedStudent('')
    ;(async () => {
      const [r, s, t] = await Promise.all([
        fetchStudentRoster(classroomId),
        fetchClassroomEduMonthSummary(classroomId),
        fetchClassroomAssessmentTrend(classroomId),
      ])
      if (!active) return
      cache.current.set('', { summary: s, trend: t })
      setRoster(r)
      setSummary(s)
      setTrend(t)
      setMonth(s.length ? s[s.length - 1].month : '')
      setLoading(false)
    })().catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [classroomId, isStaff])

  // Focusing a student re-asks for the two charts with their line included.
  useEffect(() => {
    if (!isStaff || loading) return
    const hit = cache.current.get(selectedStudent)
    if (hit) { setSummary(hit.summary); setTrend(hit.trend); return }
    let active = true
    setRefreshing(true)
    Promise.all([
      fetchClassroomEduMonthSummary(classroomId, selectedStudent),
      fetchClassroomAssessmentTrend(classroomId, selectedStudent),
    ]).then(([s, t]) => {
      if (!active) return
      cache.current.set(selectedStudent, { summary: s, trend: t })
      setSummary(s)
      setTrend(t)
    }).finally(() => { if (active) setRefreshing(false) })
    return () => { active = false }
  }, [selectedStudent, classroomId, isStaff, loading])

  const studentById = useMemo(() => new Map(roster.map(s => [s.id, s])), [roster])
  const focus = selectedStudent ? studentById.get(selectedStudent) ?? null : null
  const toggleFocus = useCallback((id: string) => setSelectedStudent(prev => (prev === id ? '' : id)), [])

  // ── EduPoints ──────────────────────────────────────────────────────────────
  const months = useMemo(() => summary.map(r => r.month), [summary])
  const monthIdx = months.indexOf(month)
  const monthRow = monthIdx >= 0 ? summary[monthIdx] : null
  const prevRow = monthIdx > 0 ? summary[monthIdx - 1] : null
  const anyPoints = summary.some(r => r.top_points > 0)

  const eduSeries = useMemo<ChartSeries[]>(() => {
    if (summary.length === 0) return []
    const series: ChartSeries[] = [
      { name: 'Class average', color: AVG_COLOR, area: true, values: summary.map(r => r.class_avg) },
      {
        name: 'Top scorer', color: TOP_COLOR, dashed: true,
        values: summary.map(r => r.top_points),
        detail: summary.map(r => r.top_student_name),
      },
    ]
    if (focus) {
      series.push({ name: focus.full_name, color: FOCUS_COLOR, values: summary.map(r => r.student_points ?? 0) })
    }
    return series
  }, [summary, focus])

  // ── Assessments ────────────────────────────────────────────────────────────
  const examSeries = useMemo<ChartSeries[]>(() => {
    const series: ChartSeries[] = [{
      name: 'Class average', color: EXAM_AVG_COLOR, area: !focus, values: trend.map(a => a.class_avg),
    }]
    if (focus) series.push({ name: focus.full_name, color: FOCUS_COLOR, area: true, values: trend.map(a => a.student_pct) })
    return series
  }, [trend, focus])

  const examStats = useMemo(() => {
    const scored = trend.filter(a => a.class_avg != null)
    const latest = scored[scored.length - 1] ?? null
    const both = trend.filter(a => a.class_avg != null && a.student_pct != null)
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    return {
      latest,
      classMean: scored.length ? mean(scored.map(a => a.class_avg as number)) : null,
      focusMean: both.length ? mean(both.map(a => a.student_pct as number)) : null,
      focusGap: both.length ? mean(both.map(a => (a.student_pct as number) - (a.class_avg as number))) : null,
    }
  }, [trend])

  if (!isStaff) {
    return (
      <div className="text-center py-16">
        <BarChart3 size={32} className="text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-600">Analysis is available to staff only.</p>
      </div>
    )
  }

  if (loading) return <AnalysisSkeleton />

  return (
    <div className="space-y-4">
      {/* Student focus (shared by both charts and the standings) */}
      <div className="flex items-center gap-3 flex-wrap">
        <StudentFocusPicker roster={roster} value={selectedStudent} onChange={setSelectedStudent} />
        {refreshing && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500" role="status">
            <Loader2 size={13} className="animate-spin" /> Updating charts
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── EduPoints by month ── */}
        <section className={`${CARD} flex flex-col`} aria-busy={refreshing}>
          <PanelHeader
            icon={<Star size={15} />} tone="amber"
            title="EduPoints by month"
            subtitle={anyPoints ? 'Class average against the month’s top scorer. Tap a month to see its standings.' : undefined}
          />
          {!anyPoints ? (
            <EmptyNote>No EduPoints earned yet. They appear when students finish work that carries points.</EmptyNote>
          ) : (
            <div className={`flex-1 flex flex-col justify-center p-3 sm:p-4 transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
              <LineChart
                labels={months.map(shortMonth)}
                series={eduSeries}
                unit=" EP"
                height={240}
                activeIndex={monthIdx}
                onSelectIndex={i => setMonth(months[i])}
                ariaLabel="EduPoints by month"
              />
            </div>
          )}
        </section>

        {/* ── Assessment scores ── */}
        <section className={`${CARD} flex flex-col`} aria-busy={refreshing}>
          <PanelHeader
            icon={<ClipboardList size={15} />} tone="indigo"
            title="Assessment scores"
            subtitle={trend.length ? (focus ? `${focus.full_name} against the class average, in %` : 'Class average per assessment, in %. Pick a student to compare.') : undefined}
          />
          {trend.length === 0 ? (
            <EmptyNote>No assessments in this classroom yet.</EmptyNote>
          ) : (
            <div className={`flex-1 flex flex-col p-3 sm:p-4 gap-3 transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat
                  label={focus ? 'Class average' : 'Average across assessments'}
                  value={examStats.classMean != null ? `${fmt(Math.round(examStats.classMean * 10) / 10)}%` : '—'}
                />
                {focus ? (
                  <MiniStat
                    label={`${firstName(focus.full_name)}’s average`}
                    value={examStats.focusMean != null ? `${fmt(Math.round(examStats.focusMean * 10) / 10)}%` : 'No marks'}
                    delta={examStats.focusGap != null ? Math.round(examStats.focusGap * 10) / 10 : null}
                    deltaSuffix=" pts vs class"
                  />
                ) : (
                  <MiniStat
                    label="Latest assessment"
                    value={examStats.latest ? `${fmt(examStats.latest.class_avg as number)}%` : '—'}
                    note={examStats.latest?.title}
                  />
                )}
              </div>
              <LineChart
                labels={trend.map(a => a.title)}
                series={examSeries}
                yMax={100}
                unit="%"
                height={200}
                ariaLabel="Assessment scores"
              />
            </div>
          )}
        </section>
      </div>

      {/* ── One month's standings ── */}
      {months.length > 0 && monthRow && (
        <section className={CARD}>
          <div className="flex items-center gap-3 flex-wrap px-3 sm:px-4 py-3 border-b border-slate-100">
            <span className="keep-round w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center flex-shrink-0">
              <CalendarDays size={15} />
            </span>
            <div className="min-w-[12rem] flex-1">
              <h3 className="text-sm font-bold text-slate-800">Monthly standings</h3>
              <p className="text-[12px] text-slate-500">Who earned what in {longMonth(month)}</p>
            </div>
            <MonthStepper months={months} value={month} onChange={setMonth} />
          </div>

          <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* Highlights */}
            <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5 content-start lg:self-start lg:sticky lg:top-4">
              <StatCell label="Class average">
                <span className="font-display text-2xl font-bold text-slate-900 tabular-nums">{fmt(monthRow.class_avg)}</span>
                <span className="text-[12px] font-semibold text-slate-500 ml-1">EP per student</span>
                {prevRow && <DeltaChip value={Math.round((monthRow.class_avg - prevRow.class_avg) * 10) / 10} suffix={` vs ${monthDate(prevRow.month).toLocaleDateString(undefined, { month: 'short' })}`} />}
              </StatCell>
              <PersonStat
                icon={<Trophy size={13} />} tone="amber" label="Top scorer"
                person={monthRow.top_student_id ? studentById.get(monthRow.top_student_id) ?? { id: monthRow.top_student_id, full_name: monthRow.top_student_name ?? 'Student', avatar_url: null } : null}
                metric={monthRow.top_points ? `${monthRow.top_points} EP` : null}
                empty="Nobody has earned points this month yet"
                onPick={toggleFocus}
              />
              <PersonStat
                icon={<TrendingUp size={13} />} tone="emerald" label="Most improved"
                person={monthRow.improved_student_id ? studentById.get(monthRow.improved_student_id) ?? { id: monthRow.improved_student_id, full_name: monthRow.improved_student_name ?? 'Student', avatar_url: null } : null}
                metric={monthRow.improved_delta ? `+${monthRow.improved_delta} EP` : null}
                empty="No rise on last month yet"
                onPick={toggleFocus}
              />
              {focus && (
                <StatCell label={focus.full_name} accent>
                  <span className="font-display text-2xl font-bold text-indigo-700 tabular-nums">{monthRow.student_points ?? 0}</span>
                  <span className="text-[12px] font-semibold text-indigo-700/70 ml-1">EP this month</span>
                  {monthRow.student_points != null && (
                    <DeltaChip value={Math.round(((monthRow.student_points ?? 0) - monthRow.class_avg) * 10) / 10} suffix=" vs class avg" />
                  )}
                </StatCell>
              )}
            </div>

            {/* Ranked list */}
            <Leaderboard
              key={classroomId}
              classroomId={classroomId}
              month={month}
              topPoints={monthRow.top_points}
              selectedStudent={selectedStudent}
              onPick={toggleFocus}
            />
          </div>
        </section>
      )}
    </div>
  )
}

function firstName(name: string): string {
  return name.split(' ')[0] || name
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

interface LeaderboardProps {
  classroomId: string
  month: string
  topPoints: number
  selectedStudent: string
  onPick: (id: string) => void
}

/** A month's ranking, by points or by rise on the month before, ten at a time.
 *  Pages already fetched are kept per month and order, so toggling back is free. */
function Leaderboard({ classroomId, month, topPoints, selectedStudent, onPick }: LeaderboardProps) {
  const [sort, setSort] = useState<EduLeaderboardSort>('total')
  const [rows, setRows] = useState<EduLeaderboardRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const pages = useRef(new Map<string, { rows: EduLeaderboardRow[]; total: number }>())
  const req = useRef(0)
  const key = `${month}|${sort}`

  useEffect(() => {
    // Any reply still in flight (a first page or a "show more") belongs to the
    // list being left; bumping the counter makes it drop itself.
    const id = ++req.current
    setLoadingMore(false)
    const hit = pages.current.get(key)
    if (hit) { setRows(hit.rows); setTotal(hit.total); setLoading(false); return }
    setLoading(true)
    fetchClassroomEduLeaderboard(classroomId, month, sort, 0, PAGE).then(r => {
      if (id !== req.current) return
      const t = r[0]?.total_count ?? 0
      pages.current.set(key, { rows: r, total: t })
      setRows(r)
      setTotal(t)
      setLoading(false)
    })
  }, [classroomId, month, sort, key])

  const loadMore = async () => {
    const id = ++req.current
    setLoadingMore(true)
    const r = await fetchClassroomEduLeaderboard(classroomId, month, sort, rows.length, PAGE)
    if (id !== req.current) return
    const next = [...rows, ...r]
    const t = r[0]?.total_count ?? total
    pages.current.set(key, { rows: next, total: t })
    setRows(next)
    setTotal(t)
    setLoadingMore(false)
  }

  const left = Math.max(0, total - rows.length)

  return (
    <div className="min-w-0 p-3 sm:p-4 border-t lg:border-t-0 lg:border-l border-slate-100">
      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-slate-100 border border-slate-200/70" role="tablist" aria-label="Order the list by">
          {([['total', 'Highest total'], ['improved', 'Most improved']] as const).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={sort === k}
              onClick={() => setSort(k)}
              className={`keep-round px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
                sort === k ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {!loading && total > 0 && (
          <span className="ml-auto text-[12px] text-slate-500 tabular-nums">{total} students</span>
        )}
      </div>

      {loading ? (
        <AnalysisLeaderboardSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">No students in this classroom yet.</p>
      ) : (
        <>
          <ol className="divide-y divide-slate-100">
            {rows.map(r => (
              <LeaderRow key={r.student_id} row={r} sort={sort} topPoints={topPoints} selected={r.student_id === selectedStudent} onPick={onPick} />
            ))}
          </ol>
          {loadingMore && <AnalysisLeaderboardSkeleton rows={3} />}
          {left > 0 && !loadingMore && (
            <button
              onClick={loadMore}
              className="keep-round mt-2 w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-full border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] transition-all"
            >
              <ChevronDown size={15} /> Show {Math.min(PAGE, left)} more
              <span className="font-medium text-slate-400">({left} left)</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}

const MEDAL = [
  'bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-[0_2px_6px_-1px_rgba(245,158,11,0.5)]',
  'bg-gradient-to-br from-slate-200 to-slate-400 text-white shadow-[0_2px_6px_-1px_rgba(100,116,139,0.45)]',
  'bg-gradient-to-br from-orange-200 to-orange-400 text-white shadow-[0_2px_6px_-1px_rgba(251,146,60,0.45)]',
]

function LeaderRow({ row, sort, topPoints, selected, onPick }: {
  row: EduLeaderboardRow
  sort: EduLeaderboardSort
  topPoints: number
  selected: boolean
  onPick: (id: string) => void
}) {
  const medal = sort === 'total' && row.points > 0 && row.rank <= 3 ? MEDAL[row.rank - 1] : null
  const rise = sort === 'improved' && row.delta > 0 && row.rank <= 3
  const pct = topPoints > 0 ? Math.max(0, Math.min(100, (row.points / topPoints) * 100)) : 0

  return (
    <li>
      <button
        onClick={() => onPick(row.student_id)}
        aria-pressed={selected}
        className={`w-full flex items-center gap-3 px-2 py-2.5 -mx-0 rounded-xl text-left transition-colors ${
          selected ? 'bg-indigo-50/80 ring-1 ring-indigo-200' : 'hover:bg-slate-50'
        }`}
      >
        <span
          className={`keep-round w-7 h-7 flex-shrink-0 rounded-full grid place-items-center text-[12px] font-bold tabular-nums ${
            medal ?? (rise ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400')
          }`}
        >
          {row.rank}
        </span>
        <Avatar avatarUrl={row.avatar_url} name={row.full_name} size={32} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] font-semibold leading-snug break-words ${selected ? 'text-indigo-900' : 'text-slate-800'}`}>
            {row.full_name}
          </span>
          {sort === 'total' ? (
            <span className="mt-1 block h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
              <span className="block h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500" style={{ width: `${pct}%` }} />
            </span>
          ) : (
            <span className="block text-[11px] text-slate-500 tabular-nums">
              {row.prev_points} → {row.points} EP
            </span>
          )}
        </span>
        <span className="flex-shrink-0 text-right">
          {sort === 'total' ? (
            <>
              <span className="block text-[14px] font-bold text-slate-900 tabular-nums">{row.points}<span className="text-[11px] font-semibold text-slate-400 ml-0.5">EP</span></span>
              <DeltaInline value={row.delta} />
            </>
          ) : (
            <DeltaInline value={row.delta} large />
          )}
        </span>
      </button>
    </li>
  )
}

function DeltaInline({ value, large }: { value: number; large?: boolean }) {
  const tone = value > 0 ? 'text-emerald-600' : value < 0 ? 'text-rose-600' : 'text-slate-400'
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${tone} ${large ? 'text-[14px]' : 'text-[11px]'}`}>
      <Icon size={large ? 14 : 11} />
      {value > 0 ? `+${value}` : value}
    </span>
  )
}

// ─── Student focus picker ─────────────────────────────────────────────────────

/** A searchable student picker: a pill showing who is in focus, opening a
 *  panel with a search field and the class list. Arrow keys move, Enter picks,
 *  Escape closes. */
function StudentFocusPicker({ roster, value, onChange }: {
  roster: ClassroomStudentLite[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const current = value ? roster.find(s => s.id === value) ?? null : null

  // '' (whole class) leads the list unless a search is typed.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q ? roster.filter(s => s.full_name.toLowerCase().includes(q)) : roster
    return q ? matches.map(s => s.id) : ['', ...matches.map(s => s.id)]
  }, [roster, query])
  const byId = useMemo(() => new Map(roster.map(s => [s.id, s])), [roster])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(Math.max(0, value ? roster.findIndex(s => s.id === value) + 1 : 0))
    requestAnimationFrame(() => inputRef.current?.focus())
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, value, roster])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (id: string) => { onChange(id); setOpen(false) }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(options.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[active] != null) pick(options[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <div ref={wrapRef} className="relative w-full sm:w-auto">
      <div
        className={`keep-round flex items-center w-full sm:w-auto sm:min-w-[18rem] rounded-full border bg-white transition-all ${
          open ? 'border-indigo-300 ring-4 ring-indigo-500/10' : 'border-slate-200 hover:border-slate-300'
        } shadow-[0_1px_2px_rgba(15,23,42,0.05)]`}
      >
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="keep-round flex-1 min-w-0 flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-full text-left"
        >
          {current ? (
            <Avatar avatarUrl={current.avatar_url} name={current.full_name} size={28} />
          ) : (
            <span className="keep-round w-7 h-7 rounded-full bg-slate-100 text-slate-500 grid place-items-center flex-shrink-0">
              <Users size={14} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-medium text-slate-500 leading-tight">Focus on</span>
            <span className="block text-[13px] font-semibold text-slate-800 leading-tight truncate">
              {current ? current.full_name : 'Whole class'}
            </span>
          </span>
          <ChevronDown size={15} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {current && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="keep-round mr-1.5 w-7 h-7 flex-shrink-0 rounded-full grid place-items-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Show the whole class"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 sm:right-auto sm:w-[20rem] top-full mt-2 z-30 rounded-2xl border border-slate-200 bg-white shadow-[0_24px_48px_-20px_rgba(15,23,42,0.35)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
            <Search size={14} className="text-slate-400 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={onKey}
              placeholder={`Search ${roster.length} students`}
              className="flex-1 min-w-0 bg-transparent text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
              role="combobox"
              aria-expanded
              aria-controls="analysis-student-list"
              aria-activedescendant={options[active] != null ? `analysis-opt-${active}` : undefined}
            />
          </div>
          <ul ref={listRef} id="analysis-student-list" role="listbox" className="max-h-72 overflow-y-auto p-1.5">
            {options.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-slate-500">No student matches “{query}”</li>
            )}
            {options.map((id, i) => {
              const s = id ? byId.get(id) : null
              const chosen = id === value
              return (
                <li
                  key={id || 'class'}
                  id={`analysis-opt-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={chosen}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pick(id)}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-xl cursor-pointer ${i === active ? 'bg-slate-100' : ''}`}
                >
                  {s ? (
                    <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={28} />
                  ) : (
                    <span className="keep-round w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center flex-shrink-0"><Users size={14} /></span>
                  )}
                  <span className={`flex-1 min-w-0 text-[13px] break-words ${chosen ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                    {s ? s.full_name : 'Whole class'}
                  </span>
                  {chosen && <Check size={15} className="text-indigo-600 flex-shrink-0" />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Month stepper ────────────────────────────────────────────────────────────

function MonthStepper({ months, value, onChange }: { months: string[]; value: string; onChange: (m: string) => void }) {
  const i = months.indexOf(value)
  const btn = 'keep-round w-8 h-8 rounded-full grid place-items-center text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition-all'
  return (
    <div className="keep-round w-full sm:w-auto flex sm:inline-flex items-center justify-between gap-0.5 p-0.5 rounded-full bg-slate-100 border border-slate-200/70">
      <button className={btn} disabled={i <= 0} onClick={() => onChange(months[i - 1])} aria-label="Previous month">
        <ChevronLeft size={16} />
      </button>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-transparent text-[13px] font-semibold text-slate-800 text-center px-1.5 py-1 min-w-[7.5rem] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-md"
        aria-label="Month"
      >
        {months.map(m => <option key={m} value={m}>{longMonth(m)}</option>)}
      </select>
      <button className={btn} disabled={i < 0 || i >= months.length - 1} onClick={() => onChange(months[i + 1])} aria-label="Next month">
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

const TONES = {
  amber: 'bg-amber-50 text-amber-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
} as const

function PanelHeader({ icon, tone, title, subtitle }: { icon: React.ReactNode; tone: keyof typeof TONES; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-slate-100">
      <span className={`keep-round w-8 h-8 rounded-full grid place-items-center flex-shrink-0 ${TONES[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {subtitle && <p className="text-[12px] text-slate-500 leading-snug">{subtitle}</p>}
      </div>
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="flex-1 flex items-center justify-center text-sm text-slate-500 text-center py-12 px-6">{children}</p>
}

function StatCell({ label, accent, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 rounded-xl border px-3.5 py-3 ${accent ? 'border-indigo-100 bg-indigo-50/60' : 'border-slate-100 bg-slate-50/70'}`}>
      <p className={`text-[11.5px] font-medium mb-1 break-words ${accent ? 'text-indigo-700/80' : 'text-slate-500'}`}>{label}</p>
      <div className="flex items-baseline flex-wrap gap-y-1">{children}</div>
    </div>
  )
}

function PersonStat({ icon, tone, label, person, metric, empty, onPick }: {
  icon: React.ReactNode
  tone: 'amber' | 'emerald'
  label: string
  person: ClassroomStudentLite | null
  metric: string | null
  empty: string
  onPick: (id: string) => void
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-500 mb-1.5">
        <span className={`keep-round w-5 h-5 rounded-full grid place-items-center ${TONES[tone]}`}>{icon}</span>
        {label}
      </p>
      {person ? (
        <button onClick={() => onPick(person.id)} className="w-full flex items-center gap-2.5 text-left group" title="Focus on this student">
          <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={34} />
          <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-slate-800 leading-snug break-words group-hover:text-indigo-700 transition-colors">
            {person.full_name}
          </span>
          {metric && (
            <span className={`flex-shrink-0 text-[13px] font-bold tabular-nums ${tone === 'amber' ? 'text-amber-600' : 'text-emerald-600'}`}>{metric}</span>
          )}
        </button>
      ) : (
        <p className="text-[13px] text-slate-500">{empty}</p>
      )}
    </div>
  )
}

function DeltaChip({ value, suffix }: { value: number; suffix: string }) {
  const tone = value > 0 ? 'bg-emerald-50 text-emerald-700' : value < 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus
  return (
    <span className="basis-full sm:basis-auto sm:ml-auto">
      <span className={`keep-round inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${tone}`}>
        <Icon size={11} />
        {value > 0 ? `+${fmt(value)}` : fmt(value)}{suffix}
      </span>
    </span>
  )
}

function MiniStat({ label, value, note, delta, deltaSuffix = '' }: {
  label: string
  value: string
  note?: string
  delta?: number | null
  deltaSuffix?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-500 break-words">{label}</p>
      <p className="font-display text-lg font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
      {note && <p className="text-[11px] text-slate-500 truncate" title={note}>{note}</p>}
      {delta != null && (
        <p className={`text-[11px] font-semibold tabular-nums ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
          {delta > 0 ? `+${fmt(delta)}` : fmt(delta)}{deltaSuffix}
        </p>
      )}
    </div>
  )
}
