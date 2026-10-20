'use client'

import React, { useState, useEffect } from 'react'
import { BarChart3, AlertTriangle, Star, ListChecks, Hourglass, CircleDot } from 'lucide-react'
import { fetchAnalyticsData, TaskAnalyticsSummary, TaskStatus } from '@/lib/tasks'
import { UserProfile } from '@/lib/supabase'
import TeamMemberSelector from './TeamMemberSelector'
import { IconChip, Seg } from './ui'

type Period = 'week' | 'month' | 'year'
const PERIODS: Period[] = ['week', 'month', 'year']
const PERIOD_LABEL: Record<Period, string> = { week: 'Last 7 days', month: 'Last 30 days', year: 'Last 12 months' }
const PERIOD_SHORT: Record<Period, string> = { week: 'Week', month: 'Month', year: 'Year' }

// Labels follow the status cycle on the calendar.
const LABELS: Record<TaskStatus, string> = {
  not_done: 'Not done',
  partial: 'Partial',
  done: 'Checking',
  checked: 'Completed',
  dismissed: 'Dismissed',
}
const STATUSES: TaskStatus[] = ['checked', 'done', 'partial', 'not_done']
const COLORS: Record<TaskStatus, string> = {
  not_done: '#f87171',
  partial: '#fb923c',
  done: '#facc15',
  checked: '#34d399',
  dismissed: '#cbd5e1',
}

interface TaskAnalyticsProps {
  userId: string
  viewingUserId?: string
  teamMembers?: UserProfile[]
  currentUserId?: string
  currentUserName?: string
  onViewingUserChange?: (userId: string) => void
  onNewTask?: () => void
}

/** The completion ring: completed as an arc over the period's total. */
function CompletionRing({ pct, size = 148 }: { pct: number; size?: number }) {
  const stroke = 14
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0" role="img" aria-label={`${pct}% completed`}>
      <defs>
        <linearGradient id="tk-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(146,64,14,0.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#tk-ring)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.22} fontWeight={700} fill="#1e293b">{pct}%</text>
      <text x="50%" y="66%" textAnchor="middle" fontSize={11} fill="#92400e" opacity={0.75}>completed</text>
    </svg>
  )
}

/** One stacked bar of the four statuses. */
function StatusBar({ counts, total, height = 10 }: { counts: Record<TaskStatus, number>; total: number; height?: number }) {
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-amber-900/[0.07]" style={{ height }}>
      {total > 0 && STATUSES.map(s => counts[s] > 0 && (
        <span key={s} title={`${LABELS[s]}: ${counts[s]}`} style={{ width: `${(counts[s] / total) * 100}%`, background: COLORS[s] }} className="h-full first:rounded-l-full last:rounded-r-full" />
      ))}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: typeof Star; label: string; value: React.ReactNode; sub?: React.ReactNode; tone: string }) {
  return (
    <div className="tk-card !rounded-[16px] p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500">
        <span className={`inline-flex w-6 h-6 rounded-[8px] items-center justify-center ${tone}`}><Icon size={13} /></span>
        <span className="min-w-0 break-words">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-[1.5rem] font-bold leading-none text-slate-800 tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[11.5px] text-slate-500 leading-snug break-words">{sub}</p>}
    </div>
  )
}

export default function TaskAnalytics({ userId, viewingUserId, teamMembers, currentUserId, currentUserName, onViewingUserChange }: TaskAnalyticsProps) {
  const [period, setPeriod] = useState<Period>('month')
  const [data, setData] = useState<Partial<Record<Period, TaskAnalyticsSummary>>>({})
  const targetUserId = viewingUserId || userId

  // All three periods load together, once per person, so switching between
  // them is instant and the comparison table needs nothing further.
  useEffect(() => {
    let cancelled = false
    setData({})
    for (const p of PERIODS) {
      fetchAnalyticsData(targetUserId, p).then(summary => {
        if (!cancelled) setData(prev => ({ ...prev, [p]: summary }))
      })
    }
    return () => { cancelled = true }
  }, [targetUserId])

  const summary = data[period]
  const loading = !summary
  const counts = summary?.counts ?? { not_done: 0, partial: 0, done: 0, checked: 0, dismissed: 0 }
  const total = summary?.total ?? 0
  const open = counts.not_done + counts.partial
  const pct = summary?.completionRate ?? 0
  const share = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

  // Plain statements read off the figures, worst first.
  const notes: { tone: string; text: string }[] = []
  if (summary) {
    if (summary.overdue > 0) notes.push({ tone: 'bg-red-400', text: `${summary.overdue} task${summary.overdue !== 1 ? 's are' : ' is'} past due and not finished.` })
    if (counts.done > 0) notes.push({ tone: 'bg-yellow-400', text: `${counts.done} done and waiting to be verified.` })
    if (counts.partial > 0) notes.push({ tone: 'bg-orange-400', text: `${counts.partial} started but not finished.` })
    if (counts.not_done > 0) notes.push({ tone: 'bg-slate-300', text: `${counts.not_done} not started yet.` })
    if (notes.length === 0 && total > 0) notes.push({ tone: 'bg-emerald-400', text: 'Everything in this period is complete.' })
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-[17px] sm:text-xl font-bold text-slate-800 flex items-center gap-2.5 mr-auto">
          <IconChip icon={BarChart3} />
          Analytics
        </h2>
        {teamMembers && teamMembers.length > 0 && currentUserId && onViewingUserChange && (
          <TeamMemberSelector
            members={teamMembers}
            selectedUserId={viewingUserId || currentUserId}
            currentUserId={currentUserId}
            currentUserName={currentUserName || ''}
            onSelect={onViewingUserChange}
          />
        )}
        <Seg value={period} onChange={setPeriod} options={PERIODS.map(p => ({ value: p, label: PERIOD_SHORT[p] }))} className="bg-white/70" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Completion */}
        <section className="tk-card lg:col-span-4 p-4 flex flex-row lg:flex-col items-center gap-4 lg:gap-3">
          {loading ? (
            <div className="w-[148px] h-[148px] rounded-full border-[14px] border-amber-900/[0.06] animate-pulse flex-shrink-0" />
          ) : (
            <CompletionRing pct={pct} />
          )}
          <div className="min-w-0 lg:text-center">
            <p className="text-[12px] font-semibold text-amber-800/80">{PERIOD_LABEL[period]}</p>
            <p className="text-[13.5px] text-slate-700 mt-0.5 leading-snug">
              {loading ? 'Loading…' : total === 0 ? 'No tasks in this period.' : <><span className="font-bold text-slate-800 tabular-nums">{counts.checked}</span> of <span className="font-bold text-slate-800 tabular-nums">{total}</span> tasks completed</>}
            </p>
          </div>
        </section>

        {/* Breakdown */}
        <section className="tk-card lg:col-span-5 overflow-hidden">
          <div className="tk-card-head px-4 py-2.5 flex items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold text-slate-800">By status</h3>
            <span className="text-[12px] text-slate-500 tabular-nums">{total} total</span>
          </div>
          <div className="p-4 space-y-3">
            <StatusBar counts={counts} total={total} height={12} />
            <div className="space-y-2">
              {STATUSES.map(s => (
                <div key={s} className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[s] }} />
                  <span className="text-[13px] text-slate-700 w-24 flex-shrink-0">{LABELS[s]}</span>
                  <span className="flex-1 h-1.5 rounded-full bg-amber-900/[0.06] overflow-hidden min-w-0">
                    <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${share(counts[s])}%`, background: COLORS[s] }} />
                  </span>
                  <span className="w-8 text-right text-[13px] font-bold text-slate-800 tabular-nums">{loading ? '–' : counts[s]}</span>
                  <span className="w-9 text-right text-[11.5px] text-slate-400 tabular-nums">{loading ? '' : `${share(counts[s])}%`}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Figures */}
        <div className="lg:col-span-3 grid grid-cols-2 gap-3 sm:gap-4 lg:gap-3 content-start">
          <Kpi icon={ListChecks} label="Open" value={loading ? '–' : open} sub="Not done or partial" tone="bg-orange-50 text-orange-600" />
          <Kpi icon={AlertTriangle} label="Overdue" value={loading ? '–' : summary.overdue} sub="Past their due date" tone="bg-red-50 text-red-500" />
          <Kpi icon={Star} label="Bonus points" value={loading ? '–' : summary.bonusPoints} sub="From completed tasks" tone="bg-amber-50 text-amber-600" />
          <Kpi icon={Hourglass} label="Checking" value={loading ? '–' : counts.done} sub="Waiting to be verified" tone="bg-yellow-50 text-yellow-600" />
        </div>

        {/* Needs attention */}
        <section className="tk-card lg:col-span-4 overflow-hidden">
          <div className="tk-card-head px-4 py-2.5">
            <h3 className="text-[13.5px] font-semibold text-slate-800 flex items-center gap-1.5"><CircleDot size={14} className="text-amber-600" /> Needs attention</h3>
          </div>
          <ul className="px-4 py-3 space-y-2">
            {loading ? (
              <li className="text-[12.5px] text-slate-400">Loading…</li>
            ) : notes.length === 0 ? (
              <li className="text-[12.5px] text-slate-500">No tasks in this period.</li>
            ) : notes.map(n => (
              <li key={n.text} className="flex items-start gap-2 text-[13px] text-slate-700 leading-snug">
                <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.tone}`} />
                <span className="min-w-0">{n.text}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Compare periods */}
        <section className="tk-card lg:col-span-8 overflow-hidden">
          <div className="tk-card-head px-4 py-2.5 flex items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold text-slate-800">Compare periods</h3>
            <span className="text-[11.5px] text-slate-500">Tap a row to view it</span>
          </div>
          <div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[11px] font-semibold text-amber-900/60">
                  <th className="text-left pl-3 sm:pl-4 pr-1 py-2">Period</th>
                  <th className="text-right px-2 py-2">Tasks</th>
                  <th className="text-right px-2 py-2">Done</th>
                  <th className="text-right px-2 py-2">Overdue</th>
                  <th className="text-right px-2 py-2">Bonus</th>
                  <th className="hidden sm:table-cell text-left px-4 py-2 w-[34%]">Status mix</th>
                </tr>
              </thead>
              <tbody>
                {PERIODS.map(p => {
                  const d = data[p]
                  const on = p === period
                  return (
                    <tr
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`border-t border-amber-900/[0.06] cursor-pointer transition-colors ${on ? 'bg-amber-50/80' : 'hover:bg-amber-50/40'}`}
                    >
                      <td className="pl-3 sm:pl-4 pr-1 py-2.5">
                        <span className={`font-semibold ${on ? 'text-amber-800' : 'text-slate-700'}`}>{PERIOD_LABEL[p]}</span>
                      </td>
                      <td className="text-right px-2 py-2.5 font-bold text-slate-800 tabular-nums">{d ? d.total : '–'}</td>
                      <td className="text-right px-2 py-2.5 tabular-nums text-emerald-600 font-semibold">{d ? `${d.completionRate}%` : '–'}</td>
                      <td className={`text-right px-2 py-2.5 tabular-nums font-semibold ${d && d.overdue > 0 ? 'text-red-500' : 'text-slate-400'}`}>{d ? d.overdue : '–'}</td>
                      <td className="text-right px-2 py-2.5 tabular-nums text-amber-600 font-semibold">{d ? d.bonusPoints : '–'}</td>
                      <td className="hidden sm:table-cell px-4 py-2.5">
                        {d ? <StatusBar counts={d.counts} total={d.total} height={8} /> : <div className="h-2 rounded-full bg-amber-900/[0.06] animate-pulse" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2 border-t border-amber-900/[0.06]">
            {STATUSES.map(s => (
              <span key={s} className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
                <span className="w-2 h-2 rounded-full" style={{ background: COLORS[s] }} /> {LABELS[s]}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
