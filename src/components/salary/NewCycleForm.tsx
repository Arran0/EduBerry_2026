'use client'

import React, { useState } from 'react'
import { CalendarRange, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { Btn, FormGroup, FormRow, Notice, SALARY_ICON, SX } from '@/components/salary/ui'
import { generateSalaryCycle, ensureDriverRecordsInCycle, ensureSupportStaffRecordsInCycle, formatPeriod } from '@/lib/salary'
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
    // Fill in any drivers or support staff the database function didn't add
    // itself, so the cycle covers everyone even before that migration has
    // been applied.
    const [drivers, support] = await Promise.all([
      ensureDriverRecordsInCycle(res.cycleId),
      ensureSupportStaffRecordsInCycle(res.cycleId),
    ])
    setSaving(false)
    if (!drivers.success) { setError(drivers.error ?? 'Cycle created, but drivers could not be added'); return }
    if (!support.success) { setError(support.error ?? 'Cycle created, but support staff could not be added'); return }
    onCreated()
  }

  return (
    <ModalShell
      onClose={onClose}
      size="md"
      sharp
      title="New pay cycle"
      subtitle="Staff, drivers and support staff in one cycle"
      icon={<CalendarRange size={16} />}
      iconClassName={SALARY_ICON}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Btn tone="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn tone="dark" onClick={save} disabled={saving}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Creating…' : `Run ${formatPeriod(month, year)}`}
          </Btn>
        </div>
      }
    >
      <FormGroup note="Everyone gets a record at their base salary. Running a month again only adds people who are missing from it; nothing already there changes.">
        <FormRow label="Month">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={`${SX.field} w-36 cursor-pointer`}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </FormRow>
        <FormRow label="Year">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className={`${SX.field} w-36 cursor-pointer`}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </FormRow>
      </FormGroup>

      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
    </ModalShell>
  )
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
