'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, CalendarRange } from 'lucide-react'
import { generateDriverCycle } from '@/lib/driverSalary'

interface DriverSalaryCycleFormProps {
  onClose: () => void
  /** Called with the generated cycle id and how many records were created. */
  onSaved: (cycleId: string, created: number) => void
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function DriverSalaryCycleForm({ onClose, onSaved }: DriverSalaryCycleFormProps) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)  // 1..12
  const [year, setYear] = useState(now.getFullYear())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  const save = async () => {
    setSaving(true); setError(null)
    const result = await generateDriverCycle(month, year)
    setSaving(false)
    if (!result.success || !result.cycleId) { setError(result.error ?? 'Failed to run cycle'); return }
    onSaved(result.cycleId, result.created ?? 0)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-100 rounded-lg"><CalendarRange size={16} className="text-emerald-600" /></div>
            <h2 className="font-bold text-slate-800">Run Monthly Cycle</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-500">
            Creates a draft payroll record for every active driver using their base salary. Re-running a month
            only adds records for drivers who don&apos;t have one yet.
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
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 btn-primary text-sm disabled:opacity-50">
              {saving ? 'Running…' : 'Run cycle'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white'
