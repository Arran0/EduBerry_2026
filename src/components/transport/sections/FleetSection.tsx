'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Bus, Plus, Pencil, Trash2, AlertTriangle, IdCard, ShieldCheck, Phone } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN, SHEET, Sheet, SheetRowSkeleton, SegTabs } from '@/components/bus/adminUI'
import {
  fetchVehicles, deleteVehicle, vehicleLabel, complianceWarnings,
} from '@/lib/transport/vehicles'
import {
  fetchTransportStaff, fetchCrewCandidates, deleteTransportStaff,
} from '@/lib/transport/staff'
import type { TransportStaff, TransportVehicle } from '@/lib/transport/types'
import { STAFF_KIND_LABELS, VEHICLE_STATUS_LABELS } from '@/lib/transport/types'
import VehicleFormModal from '../VehicleFormModal'
import CrewFormModal from '../CrewFormModal'

type Tab = 'vehicles' | 'crew'

const STATUS_BAR: Record<TransportVehicle['status'], string> = {
  active: 'bg-emerald-400',
  maintenance: 'bg-amber-400',
  retired: 'bg-[#D4D4D8]',
}

/**
 * Vehicles and crew.
 *
 * `only` lets the Manage popup open one half as its own destination — Fleet and
 * Crew are separate errands (buying a bus vs. hiring a driver) and were only
 * ever paired because they shared a loader.
 */
export default function FleetSection({ only }: { only?: 'vehicles' | 'crew' } = {}) {
  const [tab, setTab] = useState<Tab>(only ?? 'vehicles')
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([])
  const [crew, setCrew] = useState<TransportStaff[]>([])
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof fetchCrewCandidates>>>([])
  const [loading, setLoading] = useState(true)
  const [editVehicle, setEditVehicle] = useState<TransportVehicle | null | undefined>(undefined)
  const [editCrew, setEditCrew] = useState<TransportStaff | null | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    const [v, c, cand] = await Promise.all([
      fetchVehicles(), fetchTransportStaff(), fetchCrewCandidates(),
    ])
    setVehicles(v); setCrew(c); setCandidates(cand); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const tabs = useMemo(
    () => [
      { key: 'vehicles' as const, label: `Vehicles${vehicles.length ? ` (${vehicles.length})` : ''}` },
      { key: 'crew' as const, label: `Drivers & attendants${crew.length ? ` (${crew.length})` : ''}` },
    ],
    [vehicles.length, crew.length],
  )

  return (
    <div className="space-y-4">
      {!only && <SegTabs tabs={tabs} value={tab} onChange={setTab} />}

      {tab === 'vehicles' ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#71717A]">
              {loading ? 'Loading…' : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}
            </p>
            <button className={ADMIN.darkBtn} onClick={() => setEditVehicle(null)}>
              <Plus size={14} /> New vehicle
            </button>
          </div>

          <Sheet
            columns={
              <>
                <span className={`${SHEET.headCell} flex-1`}>Vehicle</span>
                <span className={`${SHEET.headCell} w-24 text-center`}>Seats</span>
                <span className={`${SHEET.headCell} w-40`}>Compliance</span>
                <span className={`${SHEET.headCell} w-20 text-right`}>Actions</span>
              </>
            }
          >
            {loading ? (
              <><SheetRowSkeleton /><SheetRowSkeleton /><SheetRowSkeleton /></>
            ) : vehicles.length === 0 ? (
              <EmptyRow
                icon={<Bus size={22} />}
                title="No vehicles yet"
                detail="Add the buses this school runs. Routes and schedules attach to them."
              />
            ) : (
              vehicles.map(v => {
                const warnings = complianceWarnings(v)
                return (
                  <div key={v.id} className={SHEET.row}>
                    <div className={`${SHEET.bar} ${STATUS_BAR[v.status]}`} />
                    <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#27272A] truncate">
                          {vehicleLabel(v)}
                          {v.status !== 'active' && (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA]">
                              {VEHICLE_STATUS_LABELS[v.status]}
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-[#71717A] truncate">
                          {v.registration_no}{v.make_model ? ` · ${v.make_model}` : ''}
                        </p>
                      </div>
                      <span className="w-24 text-center text-sm text-[#52525B] hidden sm:block">
                        {v.capacity || '—'}
                      </span>
                      <div className="w-40 hidden sm:block">
                        {warnings.length === 0 ? (
                          <span className="text-[11px] text-[#A1A1AA]">All current</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                              warnings[0].expired ? 'text-rose-600' : 'text-amber-600'
                            }`}
                          >
                            <AlertTriangle size={12} />
                            {warnings[0].label}{' '}
                            {warnings[0].expired
                              ? `expired ${Math.abs(warnings[0].daysLeft)}d ago`
                              : `in ${warnings[0].daysLeft}d`}
                            {warnings.length > 1 && ` +${warnings.length - 1}`}
                          </span>
                        )}
                      </div>
                      <RowActions
                        onEdit={() => setEditVehicle(v)}
                        onDelete={async () => {
                          if (!confirm(`Delete ${vehicleLabel(v)}? Routes pointing at it will lose the link.`)) return
                          await deleteVehicle(v.id)
                          load()
                        }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </Sheet>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#71717A]">
              {loading ? 'Loading…' : `${crew.length} record${crew.length === 1 ? '' : 's'}`}
            </p>
            <button
              className={ADMIN.darkBtn}
              onClick={() => setEditCrew(null)}
              disabled={candidates.length === 0}
              title={candidates.length === 0 ? 'Create a driver account in User Management first' : undefined}
            >
              <Plus size={14} /> New crew record
            </button>
          </div>

          {candidates.length === 0 && !loading && (
            <p className="text-[11px] text-[#A1A1AA]">
              No driver accounts yet. Create one in User Management — attendants use a driver
              account too, and their role here is set by the record you add.
            </p>
          )}

          <Sheet
            columns={
              <>
                <span className={`${SHEET.headCell} flex-1`}>Person</span>
                <span className={`${SHEET.headCell} w-28`}>Role</span>
                <span className={`${SHEET.headCell} w-44`}>Licence &amp; contact</span>
                <span className={`${SHEET.headCell} w-20 text-right`}>Actions</span>
              </>
            }
          >
            {loading ? (
              <><SheetRowSkeleton /><SheetRowSkeleton /></>
            ) : crew.length === 0 ? (
              <EmptyRow
                icon={<IdCard size={22} />}
                title="No crew records yet"
                detail="Add the drivers and attendants who work the routes. Parents see their name and phone."
              />
            ) : (
              crew.map(c => (
                <div key={c.id} className={SHEET.row}>
                  <div className={`${SHEET.bar} ${c.active ? 'bg-sky-400' : 'bg-[#D4D4D8]'}`} />
                  <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
                    <Avatar avatarUrl={c.profile?.avatar_url} name={c.profile?.full_name ?? '?'} size={30} userId={c.profile_id} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#27272A] truncate flex items-center gap-1.5">
                        {c.profile?.full_name ?? 'Unknown'}
                        {c.verified_at && <ShieldCheck size={13} className="text-emerald-500 flex-shrink-0" />}
                      </p>
                      <p className="text-[11px] text-[#71717A] truncate">
                        {c.employee_code || 'No employee code'}
                      </p>
                    </div>
                    <span className="w-28 text-xs text-[#52525B] hidden sm:block">
                      {STAFF_KIND_LABELS[c.kind]}
                    </span>
                    <div className="w-44 hidden sm:block text-[11px] text-[#71717A] truncate">
                      {c.licence_no ? `DL ${c.licence_no}` : 'No licence on file'}
                      {c.phone && (
                        <span className="flex items-center gap-1 text-[#A1A1AA]">
                          <Phone size={10} /> {c.phone}
                        </span>
                      )}
                    </div>
                    <RowActions
                      onEdit={() => setEditCrew(c)}
                      onDelete={async () => {
                        if (!confirm(`Remove the ${STAFF_KIND_LABELS[c.kind].toLowerCase()} record for ${c.profile?.full_name}?`)) return
                        await deleteTransportStaff(c.id)
                        load()
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </Sheet>
        </>
      )}

      {editVehicle !== undefined && (
        <VehicleFormModal
          vehicle={editVehicle}
          onClose={() => setEditVehicle(undefined)}
          onSaved={() => { setEditVehicle(undefined); load() }}
        />
      )}
      {editCrew !== undefined && (
        <CrewFormModal
          staff={editCrew}
          candidates={candidates}
          onClose={() => setEditCrew(undefined)}
          onSaved={() => { setEditCrew(undefined); load() }}
        />
      )}
    </div>
  )
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="w-20 flex items-center justify-end gap-1 flex-shrink-0">
      <button
        onClick={onEdit}
        className="p-1.5 rounded-md text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] transition-colors"
        aria-label="Edit"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-md text-[#A1A1AA] hover:text-rose-600 hover:bg-rose-50 transition-colors"
        aria-label="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export function EmptyRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto w-10 h-10 rounded-full bg-[#F4F4F5] text-[#A1A1AA] flex items-center justify-center mb-2">
        {icon}
      </div>
      <p className="text-sm font-semibold text-[#52525B]">{title}</p>
      <p className="text-xs text-[#A1A1AA] mt-0.5 max-w-sm mx-auto">{detail}</p>
    </div>
  )
}
