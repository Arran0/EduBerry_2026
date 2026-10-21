'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Geofencing — where staff have to be to check themselves in.
//
// Three things, in the order an admin sets them up:
//
//   School fence  — the switch, and the centre point or campus outline everyone
//                   is checked against by default.
//   Groups        — teams of staff who work somewhere else get their own fence.
//   Exemptions    — the people who may check in from anywhere.
//
// Was the Geofencing tab of App Settings (with the exemptions under its
// Attendance tab); it is its own page in Admin Space now.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { MapPin, Map as MapIcon, Navigation, Plus, ShieldCheck, Trash2, Loader2, Users } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import FenceEditor from '@/components/attendance/FenceEditor'
import { useAuth } from '@/contexts/AuthContext'
import { GEOFENCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  fetchGeofenceConfig, saveGeofenceConfig, GeofenceConfig,
  fetchGeofenceZones, saveGeofenceZones, GeofenceZone,
  fetchAllStaff, setStaffExemption, fetchAllTrackedStaff,
} from '@/lib/attendance'
import { DEFAULT_TRUSTED_ACCURACY_M } from '@/lib/geofence'
import { fetchTeamsForDropdown } from '@/lib/teams'
import { UserProfile } from '@/lib/supabase'
import { AdminPage, AX, EmptyLine, Panel, PageLoading, SaveButton, SearchField, Switch } from '@/components/admin/ui'

const GeofenceZoneModal = dynamic(() => import('@/components/attendance/GeofenceZoneModal'), { ssr: false })

export default function GeofencingPage() {
  return (
    <ProtectedLayout adminOnly>
      <AdminPage
        settingKey="geofence_banner"
        defaultBanner={GEOFENCE_BANNER_DEFAULT}
        icon={MapPin}
        backgroundIcon={Navigation}
        title="Geofencing"
        subtitle="Where staff have to be to check themselves in"
        maxWidth="max-w-6xl"
      >
        <GeofencingBody />
      </AdminPage>
    </ProtectedLayout>
  )
}

function GeofencingBody() {
  const { profile } = useAuth()

  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState<GeofenceConfig>({
    enabled: false, lat: null, lng: null, radius_m: 200,
    shape: 'circle', polygon: null,
    trusted_accuracy_m: DEFAULT_TRUSTED_ACCURACY_M,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [zones, setZones] = useState<GeofenceZone[]>([])
  const [zonesLoaded, setZonesLoaded] = useState(false)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [trackedStaff, setTrackedStaff] = useState<UserProfile[]>([])
  const [showZoneModal, setShowZoneModal] = useState(false)
  const [clearingZoneId, setClearingZoneId] = useState<string | null>(null)

  const [staff, setStaff] = useState<UserProfile[]>([])
  const [staffLoaded, setStaffLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [exemptSaving, setExemptSaving] = useState<string | null>(null)

  useEffect(() => {
    fetchGeofenceConfig().then(cfg => { if (cfg) setDraft(cfg); setLoaded(true) })
    // Zones need the team list and the staff directory too — the zone editor
    // builds its groups out of teams, exactly like the cutoff overrides do.
    Promise.all([fetchGeofenceZones(), fetchTeamsForDropdown(), fetchAllTrackedStaff()])
      .then(([z, t, tracked]) => { setZones(z); setTeams(t); setTrackedStaff(tracked); setZonesLoaded(true) })
    fetchAllStaff().then(s => { setStaff(s); setStaffLoaded(true) })
  }, [])

  async function handleSave() {
    setSaving(true)
    await saveGeofenceConfig(draft)
    setSaving(false)
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  async function reloadZones() {
    setZones(await fetchGeofenceZones())
  }

  // Deleting one zone is a full rewrite of the set (the save is replace-all),
  // so the remaining zones are sent back untouched.
  async function handleDeleteZone(zoneId: string) {
    if (!profile) return
    setClearingZoneId(zoneId)
    const remaining = zones
      .filter(z => z.id !== zoneId)
      .map(z => ({
        label: z.label, lat: z.lat, lng: z.lng, radius_m: z.radius_m,
        shape: z.shape, polygon: z.polygon, trusted_accuracy_m: z.trusted_accuracy_m,
        staff_ids: z.staff_ids,
      }))
    const ok = await saveGeofenceZones(remaining, profile.id)
    if (ok) await reloadZones()
    setClearingZoneId(null)
  }

  async function handleToggleExempt(s: UserProfile) {
    setExemptSaving(s.id)
    const next = !s.geofence_exempt
    const ok = await setStaffExemption(s.id, next)
    if (ok) setStaff(prev => prev.map(p => p.id === s.id ? { ...p, geofence_exempt: next } : p))
    setExemptSaving(null)
  }

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? staff.filter(s => s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)) : staff
    // Exempted people first: they are the list an admin comes here to check.
    return [...list].sort((a, b) => Number(!!b.geofence_exempt) - Number(!!a.geofence_exempt))
  }, [staff, query])
  const exemptCount = staff.filter(s => s.geofence_exempt).length

  if (!loaded) return <PageLoading>Loading geofence…</PageLoading>

  const hasCentre = draft.lat != null && draft.lng != null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5 items-start">
      {/* School fence — the default everyone is checked against. */}
      <div className="lg:col-span-3 space-y-4 sm:space-y-5">
        <Panel
          icon={MapIcon}
          title="School fence"
          description="Staff in no group below must be inside this fence when they check in."
        >
          <div className={`${AX.row} mb-4`}>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-[#18181B]">Check location on check-in</p>
              <p className="text-[12px] text-[#71717A]">
                {draft.enabled ? 'On — a check-in outside the fence is refused' : 'Off — staff can check in from anywhere'}
              </p>
            </div>
            <Switch on={draft.enabled} label="Check location on check-in" onChange={() => setDraft(d => ({ ...d, enabled: !d.enabled }))} />
          </div>

          <div className=" overflow-hidden">
            <FenceEditor
              idPrefix="school-fence"
              value={{ shape: draft.shape, lat: draft.lat, lng: draft.lng, radius_m: draft.radius_m, polygon: draft.polygon }}
              onChange={patch => setDraft(d => ({ ...d, ...patch }))}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {hasCentre && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#52525B] tabular-nums">
                <MapPin size={13} className="text-[#B8983C]" />
                {draft.shape === 'polygon'
                  ? `Campus outline, ${draft.polygon?.length ?? 0} corners, ${draft.radius_m} m buffer`
                  : `${draft.lat!.toFixed(6)}, ${draft.lng!.toFixed(6)} · ${draft.radius_m} m radius`}
              </span>
            )}
            <SaveButton saving={saving} saved={saved} label="Save fence" onClick={handleSave} className="ml-auto" />
          </div>
        </Panel>
      </div>

      <div className="lg:col-span-2 space-y-4 sm:space-y-5">
        {/* Groups — their own centre point and radius. */}
        <Panel
          icon={Users}
          title="Groups"
          description="Give teams that work elsewhere their own fence. A person can sit in one group only; anyone pulled in by two teams is flagged before saving."
          action={
            <button onClick={() => setShowZoneModal(true)} className={AX.ghost}>
              <Plus size={13} /> {zones.length === 0 ? 'Add' : 'Manage'}
            </button>
          }
        >
          {!zonesLoaded ? (
            <EmptyLine icon={MapPin} loading>Loading groups…</EmptyLine>
          ) : zones.length === 0 ? (
            <EmptyLine icon={MapPin}>No groups yet. Everyone uses the school fence.</EmptyLine>
          ) : (
            <ul className="space-y-1.5">
              {zones.map(z => (
                <li key={z.id} className={AX.row}>
                  <MapPin size={14} className="text-[#B8983C] flex-shrink-0" />
                  <button onClick={() => setShowZoneModal(true)} className="flex-1 min-w-0 text-left">
                    <p className="text-[13.5px] font-semibold text-[#18181B] truncate">{z.label}</p>
                    <p className="text-[12px] text-[#71717A] truncate tabular-nums">
                      {z.radius_m} m · {z.staff_ids.length} {z.staff_ids.length === 1 ? 'person' : 'people'}
                    </p>
                  </button>
                  <button
                    onClick={() => handleDeleteZone(z.id)}
                    disabled={clearingZoneId === z.id}
                    aria-label={`Delete ${z.label}`}
                    className={AX.iconDanger}
                  >
                    {clearingZoneId === z.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Exemptions — may check in from anywhere. */}
        <Panel
          icon={ShieldCheck}
          title="Exemptions"
          description={<>People switched on here can check in from outside any fence. <span className="tabular-nums">{exemptCount}</span> exempted.</>}
        >
          <SearchField value={query} onChange={setQuery} placeholder="Search staff" />
          <div className="mt-3 space-y-1.5 max-h-[26rem] overflow-y-auto overscroll-contain pr-0.5">
            {!staffLoaded ? (
              <EmptyLine icon={Users} loading>Loading staff…</EmptyLine>
            ) : filteredStaff.length === 0 ? (
              <EmptyLine icon={Users}>No staff match your search.</EmptyLine>
            ) : filteredStaff.map(s => (
              <div key={s.id} className={AX.row}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-medium text-[#18181B] truncate">{s.full_name}</p>
                  <p className="text-[11.5px] text-[#71717A] truncate"><span className="capitalize">{s.role}</span> · {s.email}</p>
                </div>
                <Switch
                  on={!!s.geofence_exempt}
                  disabled={exemptSaving === s.id}
                  label={`Exempt ${s.full_name}`}
                  onChange={() => handleToggleExempt(s)}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {showZoneModal && profile && (
        <GeofenceZoneModal
          viewerId={profile.id}
          teams={teams}
          allStaff={trackedStaff}
          schoolCentre={{ lat: draft.lat, lng: draft.lng, radius_m: draft.radius_m }}
          onClose={() => setShowZoneModal(false)}
          onSaved={reloadZones}
        />
      )}
    </div>
  )
}
