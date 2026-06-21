'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, Bus } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import { BusTrip, TripInput, createTrip, updateTrip } from '@/lib/bus'

interface TripFormModalProps {
  trip?: BusTrip | null
  drivers: UserProfile[]
  onClose: () => void
  onSaved: () => void
}

export default function TripFormModal({ trip, drivers, onClose, onSaved }: TripFormModalProps) {
  const editing = !!trip
  const [name, setName] = useState(trip?.name ?? '')
  const [route, setRoute] = useState(trip?.route_description ?? '')
  const [pickup, setPickup] = useState(trip?.pickup_time?.slice(0, 5) ?? '')
  const [drop, setDrop] = useState(trip?.drop_time?.slice(0, 5) ?? '')
  const [driverId, setDriverId] = useState(trip?.default_driver_id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) { setError('Trip name is required'); return }
    setSaving(true); setError(null)
    const input: TripInput = {
      name: name.trim(),
      route_description: route.trim() || null,
      pickup_time: pickup || null,
      drop_time: drop || null,
      default_driver_id: driverId || null,
    }
    const result = editing ? await updateTrip(trip!.id, input) : await createTrip(input)
    setSaving(false)
    if (!result.success) { setError(result.error ?? 'Failed to save trip'); return }
    onSaved()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[#27272A] rounded-t-2xl px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-lg"><Bus size={16} className="text-[#D8B967]" /></div>
            <h2 className="font-bold text-white">{editing ? 'Edit Trip' : 'New Trip'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4" style={{ backgroundColor: '#FDFCF9' }}>
          <Field label="Trip name *">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Morning Route A"
              className={inputCls} />
          </Field>

          <Field label="Route description">
            <textarea value={route} onChange={e => setRoute(e.target.value)} rows={2}
              placeholder="Stops / area covered" className={inputCls} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Pickup time">
              <input type="time" value={pickup} onChange={e => setPickup(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Drop time">
              <input type="time" value={drop} onChange={e => setDrop(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Default driver">
            <select value={driverId} onChange={e => setDriverId(e.target.value)} className={inputCls}>
              <option value="">— No driver yet —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
            {drivers.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">No driver accounts yet. Create one in User Management.</p>
            )}
          </Field>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create trip'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

const inputCls = 'w-full border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors bg-white'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-[#525252] mb-1.5 block uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}
