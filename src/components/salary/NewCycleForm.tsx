'use client'

import React, { useState } from 'react'
import { CalendarRange, AlertCircle } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { generateSalaryCycle, ensureDriverRecordsInCycle } from '@/lib/salary'

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
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
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
      title="New pay cycle"
      subtitle="Covers staff and bus drivers together"
      icon={<CalendarRange size={16} />}
      iconClassName="bg-slate-800 text-white"
      footer={
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 text-sm font-semibold py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors disabled:opacity-50">
            {saving ? 'Creating…' : 'Create cycle'}
          </button>
        </div>
      }
    >
      <p className="text-sm text-slate-500 mb-4">
        Creates a record for every staff member and bus driver, using their base salary where one is set.
        Re-running a month only adds records for people who don&apos;t have one yet.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Month</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={inputCls}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className={inputCls}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mt-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
          <AlertCircle size={14} className="flex-shrink-0" /> {error}
        </div>
      )}
    </ModalShell>
  )
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white'
