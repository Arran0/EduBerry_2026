'use client'

import React from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ChevronRight, XCircle } from 'lucide-react'
import AnimatedNumber from '@/components/charts/AnimatedNumber'
import { SkeletonTiles } from './HomeCardSkeletons'

export interface AttendanceScopeTally {
  present: number
  absent: number
  exception: number
}

/** One population on the card — the school's students, a teacher's class, a
 *  team of staff — and where its report lives. */
export interface AttendanceScope {
  key: string
  title: string
  icon: React.ElementType
  tally: AttendanceScopeTally
  /** The full report. */
  href: string
  /** Per-figure deep links into that report. */
  hrefs: { present: string; absent: string; exception: string }
}

const countFmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const pctFmt = (n: number) => `${Math.round(n)}%`

/**
 * Today's attendance as a home card, one row per scope: the scope's present
 * rate, a present / absent / irregular bar that fills in on arrival, and three
 * deep-linked counts. The one design for every role — admins and principals
 * (students over staff), coordinators (students over their teams) and class
 * teachers (their class over their team) — on phones and in the desktop deck
 * alike.
 *
 * `scopes === null` is "not loaded yet": the card shimmers in its final shape
 * rather than stating a zero nobody counted.
 */
export default function AttendanceScopesCard({ scopes, skeletonRows = 2 }: {
  scopes: AttendanceScope[] | null
  skeletonRows?: number
}) {
  const reduceMotion = useReducedMotion()
  if (scopes === null) {
    return (
      <div className="home-card pro-card h-full rounded-[20px] overflow-hidden flex flex-col">
        <SkeletonTiles rows={skeletonRows} />
      </div>
    )
  }
  return (
    <div className="home-card pro-card h-full rounded-[20px] overflow-hidden flex flex-col">
      {scopes.map((scope, si) => {
        const Icon = scope.icon
        const { present, absent, exception } = scope.tally
        const total = present + absent + exception
        const parts = [
          { key: 'present', label: 'Present', value: present, color: '#10b981', ink: 'text-emerald-700', icon: CheckCircle2, href: scope.hrefs.present },
          { key: 'absent', label: 'Absent', value: absent, color: '#ef4444', ink: 'text-red-700', icon: XCircle, href: scope.hrefs.absent },
          { key: 'irregular', label: 'Irregular', value: exception, color: '#f59e0b', ink: 'text-amber-700', icon: AlertTriangle, href: scope.hrefs.exception },
        ]
        return (
          <div key={scope.key} className={`flex-1 min-h-0 px-4 py-3 flex flex-col justify-center ${si < scopes.length - 1 ? 'border-b border-slate-200/80' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0">
                <Icon size={12} className="text-slate-500 flex-shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate" title={scope.title}>{scope.title}</span>
                <span className="ml-1 flex-shrink-0 text-[13px] font-black text-slate-900 tabular-nums">
                  {total > 0 ? <AnimatedNumber value={(present / total) * 100} format={pctFmt} delay={si * 0.15} /> : '—'}
                </span>
              </span>
              <Link href={scope.href} className="flex-shrink-0 flex items-center gap-0.5 text-[10.5px] font-semibold text-sky-700 hover:text-sky-800 transition-colors">
                {total > 0 ? 'View report' : 'Not marked yet'} <ChevronRight size={11} />
              </Link>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-200/80 overflow-hidden flex" aria-hidden>
              {total > 0 && parts.map((part, pi) => part.value > 0 && (
                <motion.div
                  key={part.key}
                  className="h-full"
                  style={{ background: part.color, width: `${(part.value / total) * 100}%`, transformOrigin: 'left' }}
                  initial={reduceMotion ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.7, ease: [0.16, 1, 0.3, 1], delay: si * 0.15 + pi * 0.25 }}
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {parts.map(part => {
                const PartIcon = part.icon
                return (
                  <Link
                    key={part.key}
                    href={part.href}
                    aria-label={`${part.value} ${part.label.toLowerCase()} — ${scope.title}`}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-1 rounded-xl bg-slate-50/80 border border-slate-200/70 hover:bg-white hover:border-slate-300/80 active:scale-95 transition-all min-w-0"
                  >
                    <PartIcon size={12} className={`flex-shrink-0 ${part.ink}`} />
                    <span className={`text-base font-black leading-none tabular-nums ${part.ink}`}>
                      <AnimatedNumber value={part.value} format={countFmt} delay={si * 0.15} />
                    </span>
                    <span className={`text-[10px] font-semibold truncate ${part.ink}`}>{part.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
