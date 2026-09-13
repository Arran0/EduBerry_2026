'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, MapPin, Users, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import { FenceShape, GeofenceZoneInput, fetchGeofenceZones, saveGeofenceZones } from '@/lib/attendance'
import { LatLng, polygonCentroid } from '@/lib/geofence'
import FenceEditor from './FenceEditor'
import { fetchTeamStaffById } from '@/lib/teams'

interface ZoneDraft {
  key: string
  label: string
  lat: string
  lng: string
  radius: string
  shape: FenceShape
  polygon: LatLng[] | null
  teamIds: string[]
  manualIds: string[]
  excludedIds: string[]
}

let draftKeySeq = 0
function nextDraftKey() {
  draftKeySeq += 1
  return `zone-${draftKeySeq}`
}

function emptyZone(index: number): ZoneDraft {
  return {
    key: nextDraftKey(), label: `Zone ${index + 1}`, lat: '', lng: '', radius: '200',
    shape: 'circle', polygon: null,
    teamIds: [], manualIds: [], excludedIds: [],
  }
}

interface ParsedCentre {
  lat: number
  lng: number
  radius: number
}

/**
 * null when the zone is not yet describable as a fence. A circle needs a valid
 * centre and radius; an outline needs at least three corners, and its centroid
 * stands in for the centre so list views still have a point to show.
 */
function parseCentre(z: ZoneDraft): ParsedCentre | null {
  const radius = parseInt(z.radius, 10)
  if (!Number.isFinite(radius) || radius < 0) return null

  if (z.shape === 'polygon') {
    if (!z.polygon || z.polygon.length < 3) return null
    const c = polygonCentroid(z.polygon)
    return { lat: c.lat, lng: c.lng, radius }
  }

  const lat = parseFloat(z.lat)
  const lng = parseFloat(z.lng)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null
  if (radius < 10) return null
  return { lat, lng, radius }
}

const inputBase = 'w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-colors'

interface Props {
  viewerId: string
  teams: { id: string; name: string }[]
  allStaff: UserProfile[]
  /** School-wide centre point — offered as a starting value for a new zone. */
  schoolCentre: { lat: number | null; lng: number | null; radius_m: number }
  onClose: () => void
  onSaved: () => void
}

export default function GeofenceZoneModal({
  viewerId, teams, allStaff, schoolCentre, onClose, onSaved,
}: Props) {
  const [zones, setZones] = useState<ZoneDraft[]>([])
  const [hasExistingZones, setHasExistingZones] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const teamCacheRef = useRef<Map<string, UserProfile[]>>(new Map())
  const [, forceRerender] = useState(0)

  const staffById = useMemo(() => new Map(allStaff.map(s => [s.id, s])), [allStaff])

  // ── Load the zones that already exist ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetchGeofenceZones().then(existing => {
      if (cancelled) return
      setHasExistingZones(existing.length > 0)
      setZones(existing.map(z => ({
        key: nextDraftKey(),
        label: z.label,
        lat: String(z.lat),
        lng: String(z.lng),
        radius: String(z.radius_m),
        shape: z.shape,
        polygon: z.polygon,
        teamIds: [],
        manualIds: [...z.staff_ids],
        excludedIds: [],
      })))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // ── Team membership helpers ─────────────────────────────────────────────────

  const ensureTeamLoaded = useCallback((teamId: string) => {
    if (teamCacheRef.current.has(teamId)) return
    fetchTeamStaffById(teamId).then(members => {
      teamCacheRef.current.set(teamId, members.filter(m => !m.attendance_hidden))
      forceRerender(v => v + 1)
    })
  }, [])

  useEffect(() => {
    for (const z of zones) {
      for (const tid of z.teamIds) ensureTeamLoaded(tid)
    }
  }, [zones, ensureTeamLoaded])

  const effectiveIds = useCallback((z: ZoneDraft): Set<string> => {
    const s = new Set<string>()
    for (const tid of z.teamIds) {
      const members = teamCacheRef.current.get(tid) ?? []
      for (const m of members) s.add(m.id)
    }
    for (const id of z.manualIds) s.add(id)
    for (const id of z.excludedIds) s.delete(id)
    return s
  }, [])

  const zoneEffective = useMemo(
    () => zones.map(z => ({ key: z.key, ids: effectiveIds(z) })),
    [zones, effectiveIds]
  )

  // A teacher pulled in by two zones has no single centre point to stand at —
  // the save is blocked until every one of these is assigned to just one zone.
  const conflicts = useMemo(() => {
    const byStaff = new Map<string, string[]>()
    for (const { key, ids } of zoneEffective) {
      for (const id of ids) {
        if (!byStaff.has(id)) byStaff.set(id, [])
        byStaff.get(id)!.push(key)
      }
    }
    const result: { staffId: string; zoneKeys: string[] }[] = []
    for (const [staffId, keys] of byStaff) {
      if (keys.length > 1) result.push({ staffId, zoneKeys: keys })
    }
    return result
  }, [zoneEffective])

  const addZone = () => setZones(prev => [...prev, {
    ...emptyZone(prev.length),
    lat: schoolCentre.lat != null ? String(schoolCentre.lat) : '',
    lng: schoolCentre.lng != null ? String(schoolCentre.lng) : '',
    radius: String(schoolCentre.radius_m || 200),
  }])

  const removeZone = (key: string) => setZones(prev => prev.filter(z => z.key !== key))

  const updateZone = (key: string, patch: Partial<ZoneDraft>) =>
    setZones(prev => prev.map(z => (z.key === key ? { ...z, ...patch } : z)))

  const toggleTeam = (zoneKey: string, teamId: string) => {
    ensureTeamLoaded(teamId)
    setZones(prev => prev.map(z => z.key === zoneKey
      ? { ...z, teamIds: z.teamIds.includes(teamId) ? z.teamIds.filter(t => t !== teamId) : [...z.teamIds, teamId] }
      : z))
  }

  const excludeStaff = (zoneKey: string, staffId: string) => {
    setZones(prev => prev.map(z => (z.key === zoneKey
      ? { ...z, manualIds: z.manualIds.filter(id => id !== staffId), excludedIds: [...new Set([...z.excludedIds, staffId])] }
      : z)))
  }

  const resolveConflict = (staffId: string, keepZoneKey: string, zoneKeys: string[]) => {
    setZones(prev => prev.map(z => {
      if (!zoneKeys.includes(z.key) || z.key === keepZoneKey) return z
      return {
        ...z,
        manualIds: z.manualIds.filter(id => id !== staffId),
        excludedIds: z.excludedIds.includes(staffId) ? z.excludedIds : [...z.excludedIds, staffId],
      }
    }))
  }


  const canSave = !saving && !loading &&
    conflicts.length === 0 &&
    zones.some(z => effectiveIds(z).size > 0) &&
    zones.every(z => effectiveIds(z).size === 0 || (!!z.label.trim() && parseCentre(z) !== null))

  const handleSave = async () => {
    setError(null)
    if (conflicts.length > 0) { setError('Resolve the highlighted conflicts before saving.'); return }

    const payload: GeofenceZoneInput[] = []
    for (const z of zones) {
      const ids = [...effectiveIds(z)]
      if (ids.length === 0) continue
      const centre = parseCentre(z)
      if (!centre) { setError(`Set a valid centre point and radius for "${z.label.trim() || 'zone'}".`); return }
      payload.push({
        label: z.label.trim() || 'Zone',
        lat: centre.lat,
        lng: centre.lng,
        radius_m: centre.radius,
        shape: z.shape,
        polygon: z.shape === 'polygon' ? z.polygon : null,
        // No admin UI sets this per zone; it always inherits the internal
        // school-wide default.
        trusted_accuracy_m: null,
        staff_ids: ids,
      })
    }
    if (payload.length === 0) { setError('Add at least one team to a zone, or clear all zones instead.'); return }

    setSaving(true)
    const ok = await saveGeofenceZones(payload, viewerId)
    setSaving(false)
    if (ok) { onSaved(); onClose() } else { setError('Failed to save. Please try again.') }
  }

  const handleClearAll = async () => {
    setError(null)
    setSaving(true)
    const ok = await saveGeofenceZones([], viewerId)
    setSaving(false)
    if (ok) { onSaved(); onClose() } else { setError('Failed to clear. Please try again.') }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 40, stiffness: 320 }}
          className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-xl flex flex-col overflow-hidden"
          style={{ maxHeight: '92dvh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Drag handle — mobile only */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div
                className="icon-chip w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                <MapPin size={18} className="relative z-10 text-white drop-shadow-sm" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-lg font-bold text-slate-800 leading-tight truncate">Geofence Zones</h2>
                <p className="text-[11px] sm:text-xs text-slate-400 truncate">Centre points per group of staff</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1 px-4 sm:px-5 py-3 sm:py-4 space-y-4">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Staff in a zone are checked against that zone&apos;s centre point instead of the school&apos;s.
              Everyone left out of every zone keeps the school-wide centre.
            </p>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
                <Loader2 size={13} className="animate-spin" /> Loading zones…
              </div>
            ) : (
              <div className="space-y-3">
                {conflicts.length > 0 && (
                  <div className="border border-red-200 bg-red-50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                      <p className="text-xs font-semibold text-red-700">
                        {conflicts.length} teacher{conflicts.length > 1 ? 's' : ''} landed in more than one zone — choose one for each
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {conflicts.map(({ staffId, zoneKeys }) => {
                        const staff = staffById.get(staffId)
                        return (
                          <div key={staffId} className="flex items-center justify-between gap-2 bg-white border border-red-100 rounded-lg px-2.5 py-1.5">
                            <span className="text-xs font-medium text-slate-700 truncate">{staff?.full_name ?? 'Unknown staff'}</span>
                            <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                              {zoneKeys.map(zk => {
                                const z = zones.find(x => x.key === zk)
                                return (
                                  <button
                                    key={zk}
                                    onClick={() => resolveConflict(staffId, zk, zoneKeys)}
                                    className="text-[10px] font-semibold px-2 py-1 border border-slate-200 text-slate-600 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 rounded-md transition-colors"
                                  >
                                    Keep in &quot;{z?.label || 'Zone'}&quot;
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {zones.length === 0 ? (
                  <p className="text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-xl px-3 py-3 text-center">
                    No zones yet. Add one to give a set of teachers their own centre point.
                  </p>
                ) : (
                  zones.map(z => {
                    const ids = [...effectiveIds(z)]
                    return (
                      <div key={z.key} className="border border-slate-200 rounded-xl p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Zone</p>
                          <button onClick={() => removeZone(z.key)} className="p-1 text-slate-300 hover:text-red-500 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div>
                          <p className="text-[11px] text-slate-400 mb-1">Name</p>
                          <input
                            value={z.label}
                            onChange={e => updateZone(z.key, { label: e.target.value })}
                            placeholder="e.g. Annexe Campus"
                            className={`${inputBase} font-medium px-3`}
                          />
                        </div>

                        <div className="pl-1">
                          <FenceEditor
                            idPrefix={`zone-${z.key}`}
                            dense
                            value={{
                              shape: z.shape,
                              lat: z.lat ? parseFloat(z.lat) : null,
                              lng: z.lng ? parseFloat(z.lng) : null,
                              radius_m: parseInt(z.radius, 10) || 200,
                              polygon: z.polygon,
                            }}
                            onChange={patch => updateZone(z.key, {
                              ...(patch.shape !== undefined ? { shape: patch.shape } : {}),
                              ...(patch.lat !== undefined ? { lat: patch.lat != null ? String(patch.lat) : '' } : {}),
                              ...(patch.lng !== undefined ? { lng: patch.lng != null ? String(patch.lng) : '' } : {}),
                              ...(patch.radius_m !== undefined ? { radius: String(patch.radius_m) } : {}),
                              ...(patch.polygon !== undefined ? { polygon: patch.polygon } : {}),
                            })}
                          />
                        </div>

                        <div className="pl-1">
                          <p className="text-[10px] text-slate-400 mb-1">Add teachers from a team</p>
                          <div className="flex flex-wrap gap-1.5">
                            {teams.map(t => {
                              const active = z.teamIds.includes(t.id)
                              return (
                                <button
                                  key={t.id}
                                  onClick={() => toggleTeam(z.key, t.id)}
                                  className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
                                    active ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  {t.name}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {ids.length > 0 && (
                          <div className="pl-1">
                            <p className="text-[10px] text-slate-400 mb-1">
                              {ids.length} teacher{ids.length === 1 ? '' : 's'}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {ids.map(id => {
                                const staff = staffById.get(id)
                                const conflicted = conflicts.some(c => c.staffId === id && c.zoneKeys.includes(z.key))
                                return (
                                  <span
                                    key={id}
                                    className={`flex items-center gap-1 text-[11px] pl-2 pr-1 py-0.5 rounded-full border ${
                                      conflicted ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                                    }`}
                                  >
                                    {staff?.full_name ?? 'Unknown'}
                                    <button onClick={() => excludeStaff(z.key, id)} className="hover:text-red-600">
                                      <X size={10} />
                                    </button>
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}

                <button
                  type="button"
                  onClick={addZone}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-emerald-300 text-emerald-700 text-xs font-semibold hover:bg-emerald-50 transition-colors"
                >
                  <Plus size={13} /> Add another zone
                </button>
              </div>
            )}

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}

            <div className="h-1" />
          </div>

          {/* Sticky footer */}
          <div
            className="flex items-center gap-2 px-4 sm:px-5 py-3 border-t border-slate-100 flex-shrink-0"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
          >
            {hasExistingZones && (
              <button
                type="button"
                onClick={handleClearAll}
                disabled={saving}
                title="Remove all zones"
                className="flex-shrink-0 p-3.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold py-3.5 rounded-2xl transition-all disabled:opacity-50 text-sm shadow-lg shadow-emerald-500/25 active:scale-[0.98]"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
              {saving ? 'Saving…' : 'Save Zones'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
