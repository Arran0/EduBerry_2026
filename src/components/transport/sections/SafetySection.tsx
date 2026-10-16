'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertOctagon, ShieldCheck, MapPin, Users, Clock, ChevronDown, Loader2,
} from 'lucide-react'
import { ADMIN, EmptyRow } from '@/components/bus/adminUI'
import {
  fetchIncidents, formatClock, resolveIncident,
  INCIDENT_LABELS, type TransportIncident,
} from '@/lib/transport/runs'

/**
 * The incident console.
 *
 * Everything shown for a past incident comes from its frozen snapshot, not from
 * the live tables — so a record from three weeks ago still names the crew and
 * the children who were actually aboard, even after the roster has changed.
 */
export default function SafetySection() {
  const [incidents, setIncidents] = useState<TransportIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setIncidents(await fetchIncidents())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const open = incidents.filter(i => i.status === 'open' || i.status === 'responding')
  const past = incidents.filter(i => i.status === 'resolved' || i.status === 'false_alarm')

  const close = async (incident: TransportIncident, falseAlarm: boolean) => {
    const note = prompt(
      falseAlarm
        ? 'Why was this a false alarm?'
        : 'What happened, and how was it resolved?',
    )
    if (note === null) return
    setBusy(true)
    await resolveIncident(incident.id, note, falseAlarm)
    setBusy(false)
    load()
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className={ADMIN.label}>Open incidents</p>
          {open.length > 0 && (
            <span className="text-[11px] font-bold text-rose-600">{open.length} needing attention</span>
          )}
        </div>

        {loading ? (
          <div className="h-24 rounded-xl bg-[#F4F4F5] animate-pulse" />
        ) : open.length === 0 ? (
          <div className="border border-dashed border-[#E4E4E7] rounded-xl px-4 py-8 text-center">
            <ShieldCheck size={22} className="mx-auto text-emerald-500 mb-2" />
            <p className="text-sm font-semibold text-[#52525B]">No open incidents</p>
            <p className="text-[11px] text-[#A1A1AA] mt-0.5">
              A driver holding the emergency button raises one here immediately, with
              the bus&apos;s position and who was on board at that moment.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {open.map(i => (
              <IncidentCard
                key={i.id} incident={i} expanded={openId === i.id} busy={busy}
                onToggle={() => setOpenId(openId === i.id ? null : i.id)}
                onResolve={() => close(i, false)}
                onFalseAlarm={() => close(i, true)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <p className={`${ADMIN.label} mb-2`}>History</p>
        {past.length === 0 ? (
          <EmptyRow
            icon={<AlertOctagon size={22} />}
            title="Nothing yet"
            detail="Every incident stays here permanently, with the record of what was known at the time."
          />
        ) : (
          <div className="space-y-2">
            {past.map(i => (
              <IncidentCard
                key={i.id} incident={i} expanded={openId === i.id} busy={busy}
                onToggle={() => setOpenId(openId === i.id ? null : i.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface Snapshot {
  route?: { name?: string }
  vehicle?: { registration_no?: string; display_name?: string }
  driver?: { name?: string; phone?: string; licence_no?: string }
  attendant?: { name?: string; phone?: string }
  onboard?: { student_id: string; name: string; grade?: number; section?: string; guardian_phone?: string }[]
  last_fix?: { lat?: number; lng?: number; at?: string }
  current_stop?: { name?: string }
  next_stop?: { name?: string }
}

function IncidentCard({
  incident, expanded, busy, onToggle, onResolve, onFalseAlarm,
}: {
  incident: TransportIncident
  expanded: boolean
  busy: boolean
  onToggle: () => void
  onResolve?: () => void
  onFalseAlarm?: () => void
}) {
  const snap = incident.snapshot as Snapshot
  const live = incident.status === 'open' || incident.status === 'responding'
  const onboard = snap.onboard ?? []

  return (
    <div className={`rounded-xl border overflow-hidden ${live ? 'border-rose-200 bg-rose-50' : 'border-[#E4E4E7] bg-white'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
        <AlertOctagon size={16} className={live ? 'text-rose-600 flex-shrink-0' : 'text-[#A1A1AA] flex-shrink-0'} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${live ? 'text-rose-900' : 'text-[#27272A]'}`}>
            {INCIDENT_LABELS[incident.type]}
            {snap.route?.name ? ` · ${snap.route.name}` : ''}
          </p>
          <p className={`text-[11px] truncate ${live ? 'text-rose-700' : 'text-[#71717A]'}`}>
            {new Date(incident.occurred_at).toLocaleString()}
            {onboard.length > 0 && ` · ${onboard.length} on board`}
            {incident.status === 'false_alarm' && ' · false alarm'}
            {incident.status === 'resolved' && ' · resolved'}
          </p>
        </div>
        <ChevronDown
          size={16}
          className={`text-[#A1A1AA] flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-black/5 px-3.5 py-3 space-y-3 bg-white">
          {incident.description && (
            <p className="text-sm text-[#52525B]">{incident.description}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <Detail label="Crew">
              {snap.driver?.name ?? 'Unknown driver'}
              {snap.driver?.phone && <span className="block text-[#A1A1AA]">{snap.driver.phone}</span>}
              {snap.attendant?.name && <span className="block">{snap.attendant.name} (attendant)</span>}
            </Detail>
            <Detail label="Vehicle">
              {snap.vehicle?.display_name ?? snap.vehicle?.registration_no ?? 'Unknown'}
              {snap.vehicle?.registration_no && (
                <span className="block text-[#A1A1AA]">{snap.vehicle.registration_no}</span>
              )}
            </Detail>
            <Detail label="Position when raised">
              {incident.lat != null && incident.lng != null ? (
                <a
                  className="text-sky-700 hover:underline inline-flex items-center gap-1"
                  href={`https://www.google.com/maps?q=${incident.lat},${incident.lng}`}
                  target="_blank" rel="noreferrer"
                >
                  <MapPin size={11} /> {incident.lat.toFixed(5)}, {incident.lng.toFixed(5)}
                </a>
              ) : 'Not recorded'}
            </Detail>
            <Detail label="Trip context">
              {snap.current_stop?.name ? `At ${snap.current_stop.name}` : 'Between stops'}
              {snap.next_stop?.name && <span className="block text-[#A1A1AA]">Next: {snap.next_stop.name}</span>}
              {snap.last_fix?.at && (
                <span className="block text-[#A1A1AA] inline-flex items-center gap-1">
                  <Clock size={10} /> last fix {formatClock(snap.last_fix.at)}
                </span>
              )}
            </Detail>
          </div>

          <div>
            <p className={`${ADMIN.label} flex items-center gap-1`}>
              <Users size={11} /> On board at that moment ({onboard.length})
            </p>
            {onboard.length === 0 ? (
              <p className="text-[11px] text-[#A1A1AA] mt-1">Nobody was marked on board.</p>
            ) : (
              <div className="mt-1.5 border border-[#F4F4F5] rounded-lg divide-y divide-[#F4F4F5]">
                {onboard.map(s => (
                  <div key={s.student_id} className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="flex-1 min-w-0 text-xs text-[#27272A] truncate">{s.name}</span>
                    <span className="text-[11px] text-[#A1A1AA]">
                      {s.grade ? `Grade ${s.grade}${s.section ? ` ${s.section}` : ''}` : ''}
                    </span>
                    {s.guardian_phone && (
                      <a href={`tel:${s.guardian_phone.replace(/\D/g, '')}`}
                        className="text-[11px] font-semibold text-sky-700 hover:underline">
                        {s.guardian_phone}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {incident.resolution_note && (
            <p className="text-xs text-[#52525B] bg-[#FAFAFA] border border-[#F4F4F5] rounded-lg px-2.5 py-2">
              {incident.resolution_note}
            </p>
          )}

          {live && onResolve && onFalseAlarm && (
            <div className="flex items-center gap-2">
              <button className={ADMIN.darkBtn} onClick={onResolve} disabled={busy}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                Mark resolved
              </button>
              <button className={ADMIN.ghostBtn} onClick={onFalseAlarm} disabled={busy}>
                False alarm
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={ADMIN.label}>{label}</p>
      <div className="text-[#52525B] mt-0.5">{children}</div>
    </div>
  )
}
