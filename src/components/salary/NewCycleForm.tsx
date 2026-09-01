'use client'

import React, { useState } from 'react'
import { CalendarRange, AlertCircle } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { Btn, LABEL } from '@/components/salary/ui'
import { generateSalaryCycle, ensureDriverRecordsInCycle, formatPeriod } from '@/lib/salary'
import { defaultPayrollMonth } from '@/lib/salaryStats'

/**
 * Starts a month's payroll in one action.
 *
 * One cycle covers everyone who gets paid — teaching staff, non-teaching
 * staff and bus drivers all land in the same list. Re-running a month is
 * safe: the generator is idempotent, so an existing cycle is left alone and
 * only picks up people who don't have a record in it yet.
 */
export default function NewCycleForm({ onClose, onCreated }: {
  onClose: () => void
  onCreated: () => void
}) {
  const now = new Date()
  // Opens on the month most likely to be run right now — the one just ended,
  // for the first ten days of a month, which is when payroll is processed.
  const suggested = defaultPayrollMonth(now)
  const [month, setMonth] = useState(suggested.month)
  const [year, setYear] = useState(suggested.year)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  const save = async () => {
    setSaving(true); setError(null)
    const res = await generateSalaryCycle(month, year)
    if (!res.success || !res.cycleId) {
      setSaving(false)
      setError(res.error ?? 'Failed to create the cycle')
      return
    }
    // Fill in any drivers the database function didn't add itself, so the
    // cycle covers everyone even before that migration has been applied.
    const drivers = await ensureDriverRecordsInCycle(res.cycleId)
    setSaving(false)
    if (!drivers.success) { setError(drivers.error ?? 'Cycle created, but drivers could not be added'); return }
    onCreated()
  }

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      sharp
      title="New pay cycle"
      subtitle="Staff and bus drivers together"
      icon={<CalendarRange size={15} />}
      iconClassName="bg-[#27272A] text-[#B8983C]"
      footer={
        <div className="flex gap-1.5 justify-end">
          <Btn tone="ghost" onClick={onClose}>Cancel</Btn>
          <Btn tone="dark" onClick={save} disabled={saving}>
            {saving ? 'Creating…' : `Run ${formatPeriod(month, year)}`}
          </Btn>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={`${LABEL} block mb-1`}>Month</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={FIELD}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={`${LABEL} block mb-1`}>Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className={FIELD}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <p className="text-[12px] text-[#6B675A] leading-relaxed mt-3">
        Creates a record for every staff member and bus driver, using their base salary where one is set.
        Re-running a month only adds records for people who don&apos;t have one yet — nothing already in the
        cycle is touched.
      </p>

      {error && (
        <div className="flex items-start gap-1.5 p-2 mt-3 bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-[11.5px]">
          <AlertCircle size={13} className="flex-shrink-0 mt-px" /> {error}
        </div>
      )}
    </ModalShell>
  )
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const FIELD = 'w-full bg-white border border-[#E3DFD3] px-2 py-[7px] text-[12.5px] leading-none text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors'
