'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { BellRing, ChevronRight } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { fetchInvoiceLines, fetchInvoices, type InvoiceLineRow } from '@/lib/fees/invoices'
import { todayIn } from '@/lib/fees/engine/dates'
import { daysBetween, isOpen } from '@/components/fees/student/studentFees'
import { formatINR } from '@/components/bus/FeeCollectionSummary'

/**
 * A line is a bus fee when the fee app says so in its label.
 *
 * Bus fees are fee-app bills under the session's Bus fee head; a monthly
 * billing run labels each line "Bus fee — <route> — <month>". The head's
 * `is_transport` flag would be exact, but fee_heads is not readable by
 * students (RLS: fees.view), so the label is what the family can see.
 */
const BUS_LINE = /\b(bus|transport)\b/i
const isBusLine = (l: InvoiceLineRow) =>
  (l.kind === 'fee' || l.kind === 'carry_forward') && BUS_LINE.test(l.label)

interface Reminder {
  due: number
  bills: number
  /** Days until the earliest open bus bill is due; negative when overdue. */
  days: number
}

/**
 * The bus fee, as a reminder rather than a tab.
 *
 * The bus screen is for tracking; paying happens in Fees, where every bill and
 * receipt already lives. So this shows only when something is owed, says how
 * much and by when, and hands off to Fees. Nothing owed, no banner.
 */
export default function BusFeeReminder({ studentId }: { studentId: string }) {
  const { year } = useAcademicYear()
  const [reminder, setReminder] = useState<Reminder | null>(null)

  useEffect(() => {
    if (!year) return
    let alive = true
    ;(async () => {
      try {
        const open = (await fetchInvoices({ academicYearId: year.id, studentId }))
          .filter(i => i.status !== 'draft' && isOpen(i))
        if (!open.length) { if (alive) setReminder(null); return }
        const lines = await fetchInvoiceLines(open.map(i => i.id))
        const today = todayIn()
        let due = 0, bills = 0, days = Infinity
        for (const inv of open) {
          const busTotal = lines.filter(l => l.invoice_id === inv.id && isBusLine(l))
            .reduce((s, l) => s + (Number(l.amount) || 0), 0)
          if (busTotal <= 0) continue
          // A bill can carry tuition and the bus together; what is owed on the
          // bus is never more than the bill's balance.
          due += Math.min(busTotal, Number(inv.balance) || 0)
          bills += 1
          days = Math.min(days, daysBetween(today, inv.due_date))
        }
        if (alive) setReminder(bills > 0 && due > 0 ? { due, bills, days } : null)
      } catch {
        // A reminder that cannot load is simply not shown; Fees still has it.
        if (alive) setReminder(null)
      }
    })()
    return () => { alive = false }
  }, [year, studentId])

  if (!reminder) return null

  const late = reminder.days < 0
  const when = late
    ? reminder.days === -1 ? 'Overdue by 1 day' : `Overdue by ${-reminder.days} days`
    : reminder.days === 0 ? 'Due today'
      : reminder.days === 1 ? 'Due tomorrow'
        : `Due in ${reminder.days} days`

  return (
    <Link
      href="/more/fees"
      className="bus-glass group flex items-center gap-3 px-3.5 py-3 sm:px-4 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFC72C]"
    >
      <span
        className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,.6)] ${
          late ? 'bg-rose-500 text-white' : 'bg-[#FFC72C] text-[#13306B]'
        }`}
      >
        <BellRing size={18} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-bold text-[#13306B] leading-tight">
          Bus fee {formatINR(reminder.due)}
        </span>
        <span className={`block text-[12.5px] mt-0.5 ${late ? 'text-rose-700 font-semibold' : 'text-[#5B6676]'}`}>
          {when}
          {reminder.bills > 1 ? ` · across ${reminder.bills} bills` : ''}
        </span>
      </span>
      <span className="inline-flex items-center gap-0.5 h-9 pl-3.5 pr-2.5 rounded-full bg-[#13306B] text-white text-[13px] font-semibold flex-shrink-0 group-hover:bg-[#0B2150] transition-colors">
        Pay <ChevronRight size={15} />
      </span>
    </Link>
  )
}
