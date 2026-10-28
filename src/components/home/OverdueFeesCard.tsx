'use client'

import React from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import type { OverdueBill } from '@/lib/fees/invoices'
import { billFor } from '@/components/fees/student/studentFees'
import { SkeletonRows } from './HomeCardSkeletons'

function formatAmount(n: number): string {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function formatDue(dateStr: string | null): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface OverdueFeesCardProps {
  /** Bills past their due date with money still owed (fetchOverdueBills). */
  fees: OverdueBill[]
  /** The fee fetch is still in flight — see ExamGradingCard's note. Telling a
   *  student they are all paid up before anyone has looked is the one thing
   *  this card must never do. */
  loading?: boolean
}

/** A student's bills past their due date, each row linking to the fees app.
 *  The mobile carousel only carries this card when there are any; the desktop
 *  dashboard shows every card, so an empty list reads as "nothing overdue"
 *  (good news worth stating) rather than an empty box. */
export default function OverdueFeesCard({ fees, loading = false }: OverdueFeesCardProps) {
  const total = fees.reduce((sum, f) => sum + (Number(f.balance) || 0), 0)

  if (loading) {
    return (
      <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
        <SkeletonRows rows={3} />
      </div>
    )
  }

  if (fees.length === 0) {
    return (
      <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
          <CheckCircle2 size={22} className="text-emerald-300" />
        </div>
        <p className="text-sm font-medium text-slate-400">No fees overdue</p>
        <p className="text-xs text-slate-300 mt-1">You&apos;re all paid up</p>
      </div>
    )
  }

  return (
    <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col border border-red-200/60">
      <div className="px-5 pt-4 pb-3 border-b border-white/25 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
          <span className="text-sm font-bold text-red-600">Overdue fees</span>
        </div>
        <span className="text-sm font-black text-red-600 tabular-nums flex-shrink-0">{formatAmount(total)}</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-white/25">
        {fees.map(fee => (
          <Link key={fee.id} href="/more/fees">
            <div className="home-card-row flex items-center gap-3 px-5 py-3 hover:bg-white/45 transition-colors group cursor-pointer">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-500" />
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-slate-800 text-sm truncate group-hover:text-slate-900 transition-colors">
                  {billFor(fee.lines)}
                </h4>
                <p className="text-[11px] text-red-400 truncate">Due {formatDue(fee.due_date)}</p>
              </div>
              <span className="flex-shrink-0 text-xs font-semibold text-slate-600 tabular-nums">{formatAmount(fee.balance ?? 0)}</span>
              <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
