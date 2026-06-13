'use client'

import React, { useState } from 'react'
import { CalendarClock, Trash2, AlertCircle, Plus } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import { TripDriverOverride, setDriverOverride, clearDriverOverride } from '@/lib/bus'

interface DriverOverrideEditorProps {
  tripId: string
  drivers: UserProfile[]
  overrides: TripDriverOverride[]
  onChanged: () => void
}

function fmtDate(d: string): string {
  // d is YYYY-MM-DD — render without timezone shifting.
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function DriverOverrideEditor({ tripId, drivers, overrides, onChanged }: DriverOverrideEditorProps) {
  const [date, setDate] = useState('')
  const [driverId, setDriverId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    if (!date || !driverId) { setError('Pick both a date and a driver'); return }
    setBusy(true); setError(null)
    const result = await setDriverOverride(tripId, date, driverId)
    setBusy(false)
    if (!result.success) { setError(result.error ?? 'Failed to set override'); return }
    setDate(''); setDriverId('')
    onChanged()
  }

  const remove = async (d: string) => {
    setBusy(true); setError(null)
    const result = await clearDriverOverride(tripId, d)
    setBusy(false)
    if (!result.success) { setError(result.error ?? 'Failed to remove override'); return }
    onChanged()
  }

  const driverName = (id: string) => drivers.find(d => d.id === id)?.full_name ?? 'Unknown driver'
  const today = new Date().toLocaleDateString('en-CA')

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3 leading-relaxed">
        Assign a substitute driver for a specific date. On that date the substitute — not the
        default driver — runs the trip and marks attendance.
      </p>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input type="date" min={today} value={date} onChange={e => setDate(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400/40" />
        <select value={driverId} onChange={e => setDriverId(e.target.value)}
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400/40">
          <option value="">— Substitute driver —</option>
          {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <button onClick={add} disabled={busy || !date || !driverId}
          className="btn-primary text-sm flex items-center justify-center gap-1.5 disabled:opacity-50">
          <Plus size={15} /> Add
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
          <AlertCircle size={14} className="flex-shrink-0" /> {error}
        </div>
      )}

      {overrides.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">No substitute drivers scheduled.</p>
      ) : (
        <div className="space-y-2">
          {overrides.map(o => (
            <div key={o.id} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <CalendarClock size={16} className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{fmtDate(o.date)}</p>
                <p className="text-[11px] text-slate-500">{o.driver?.full_name ?? driverName(o.driver_id)}</p>
              </div>
              <button onClick={() => remove(o.date)} disabled={busy}
                className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
