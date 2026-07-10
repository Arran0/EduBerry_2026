'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Clock, Users, Plus, Trash2, AlertTriangle, Loader2, Check } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import { DayTimingGroup, DayTimingGroupInput, saveDayTimings } from '@/lib/attendance'
import { fetchTeamStaffById } from '@/lib/teams'

interface GroupDraft {
  key: string
  label: string
  lateCutoff: string
  checkoutCutoff: string
  teamIds: string[]
  manualIds: string[]
  excludedIds: string[]
}

function toHHMM(time: string | null | undefined): string {
  if (!time) return ''
  return time.slice(0, 5)
}

let draftKeySeq = 0
function nextDraftKey() {
  draftKeySeq += 1
  return `draft-${draftKeySeq}`
}

interface Props {
  date: string
  viewerId: string
  teams: { id: string; name: string }[]
  existingTimings: DayTimingGroup[]
  allStaff: UserProfile[]
  onClose: () => void
  onSaved: () => void
}

export default function DayTimingModal({
  date, viewerId, teams, existingTimings, allStaff, onClose, onSaved,
}: Props) {
  const defaultExisting = existingTimings.find(t => t.is_default) ?? null
  const groupExisting = existingTimings.filter(t => !t.is_default)

  const [defaultEnabled, setDefaultEnabled] = useState(!!defaultExisting)
  const [defaultLateCutoff, setDefaultLateCutoff] = useState(toHHMM(defaultExisting?.late_cutoff))
  const [defaultCheckoutCutoff, setDefaultCheckoutCutoff] = useState(toHHMM(defaultExisting?.checkout_cutoff))

  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    groupExisting.map(g => ({
      key: nextDraftKey(),
      label: g.label,
      lateCutoff: toHHMM(g.late_cutoff),
      checkoutCutoff: toHHMM(g.checkout_cutoff),
      teamIds: [],
      manualIds: [...g.staff_ids],
      excludedIds: [],
    }))
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const teamCacheRef = useRef<Map<string, UserProfile[]>>(new Map())
  const [, forceRerender] = useState(0)

  const staffById = useMemo(() => new Map(allStaff.map(s => [s.id, s])), [allStaff])

  const ensureTeamLoaded = useCallback((teamId: string) => {
    if (teamCacheRef.current.has(teamId)) return
    fetchTeamStaffById(teamId).then(members => {
      teamCacheRef.current.set(teamId, members.filter(m => m.role !== 'admin'))
      forceRerender(v => v + 1)
    })
  }, [])

  useEffect(() => {
    for (const g of groups) {
      for (const tid of g.teamIds) ensureTeamLoaded(tid)
    }
  }, [groups, ensureTeamLoaded])

  const effectiveIds = useCallback((g: GroupDraft): Set<string> => {
    const s = new Set<string>()
    for (const tid of g.teamIds) {
      const members = teamCacheRef.current.get(tid) ?? []
      for (const m of members) s.add(m.id)
    }
    for (const id of g.manualIds) s.add(id)
    for (const id of g.excludedIds) s.delete(id)
    return s
  }, [])

  const groupEffective = useMemo(
    () => groups.map(g => ({ key: g.key, label: g.label, ids: effectiveIds(g) })),
    [groups, effectiveIds]
  )

  const conflicts = useMemo(() => {
    const byStaff = new Map<string, string[]>()
    for (const { key, ids } of groupEffective) {
      for (const id of ids) {
        if (!byStaff.has(id)) byStaff.set(id, [])
        byStaff.get(id)!.push(key)
      }
    }
    const result: { staffId: string; groupKeys: string[] }[] = []
    for (const [staffId, keys] of byStaff) {
      if (keys.length > 1) result.push({ staffId, groupKeys: keys })
    }
    return result
  }, [groupEffective])

  const addGroup = () => {
    setGroups(prev => [...prev, {
      key: nextDraftKey(), label: `Group ${prev.length + 1}`, lateCutoff: '', checkoutCutoff: '',
      teamIds: [], manualIds: [], excludedIds: [],
    }])
  }

  const removeGroup = (key: string) => setGroups(prev => prev.filter(g => g.key !== key))

  const updateGroup = (key: string, patch: Partial<GroupDraft>) =>
    setGroups(prev => prev.map(g => (g.key === key ? { ...g, ...patch } : g)))

  const toggleTeam = (groupKey: string, teamId: string) => {
    ensureTeamLoaded(teamId)
    setGroups(prev => prev.map(g => g.key === groupKey
      ? { ...g, teamIds: g.teamIds.includes(teamId) ? g.teamIds.filter(t => t !== teamId) : [...g.teamIds, teamId] }
      : g))
  }

  const excludeStaff = (groupKey: string, staffId: string) => {
    setGroups(prev => prev.map(g => (g.key === groupKey
      ? { ...g, manualIds: g.manualIds.filter(id => id !== staffId), excludedIds: [...new Set([...g.excludedIds, staffId])] }
      : g)))
  }

  const resolveConflict = (staffId: string, keepGroupKey: string, groupKeys: string[]) => {
    setGroups(prev => prev.map(g => {
      if (!groupKeys.includes(g.key) || g.key === keepGroupKey) return g
      return {
        ...g,
        manualIds: g.manualIds.filter(id => id !== staffId),
        excludedIds: g.excludedIds.includes(staffId) ? g.excludedIds : [...g.excludedIds, staffId],
      }
    }))
  }

  const canSave = conflicts.length === 0 && !saving &&
    (defaultEnabled ? !!(defaultLateCutoff && defaultCheckoutCutoff) : true) &&
    groups.every(g => (effectiveIds(g).size === 0) || (!!g.lateCutoff && !!g.checkoutCutoff && !!g.label.trim()))

  const handleSave = async () => {
    setError(null)
    if (conflicts.length > 0) { setError('Resolve the highlighted conflicts before saving.'); return }
    if (defaultEnabled && (!defaultLateCutoff || !defaultCheckoutCutoff)) {
      setError('Set both a late cutoff and a checkout cutoff for the default override.')
      return
    }

    const payload: DayTimingGroupInput[] = []
    if (defaultEnabled && defaultLateCutoff && defaultCheckoutCutoff) {
      payload.push({
        label: 'Default', is_default: true,
        late_cutoff: defaultLateCutoff, checkout_cutoff: defaultCheckoutCutoff, staff_ids: [],
      })
    }
    for (const g of groups) {
      const ids = [...effectiveIds(g)]
      if (ids.length === 0) continue
      if (!g.lateCutoff || !g.checkoutCutoff) {
        setError(`Set a late cutoff and checkout cutoff for "${g.label || 'group'}".`)
        return
      }
      payload.push({
        label: g.label.trim() || 'Group', is_default: false,
        late_cutoff: g.lateCutoff, checkout_cutoff: g.checkoutCutoff, staff_ids: ids,
      })
    }

    setSaving(true)
    const ok = await saveDayTimings(date, payload, viewerId)
    setSaving(false)
    if (ok) { onSaved(); onClose() } else { setError('Failed to save. Please try again.') }
  }

  const formattedDate = useMemo(() => new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  }), [date])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 16 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Clock size={16} className="text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-800 text-sm">Late &amp; Checkout Cutoffs</p>
              <p className="text-[11px] text-slate-500">{formattedDate}</p>
            </div>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
            {/* Default cutoffs for the day */}
            <div>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={defaultEnabled}
                  onChange={e => setDefaultEnabled(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="text-sm font-semibold text-slate-700">Override the late &amp; checkout cutoff for everyone</span>
              </label>
              {defaultEnabled && (
                <div className="flex items-center gap-3 pl-6">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Late after</span>
                    <input
                      type="time" value={defaultLateCutoff} onChange={e => setDefaultLateCutoff(e.target.value)}
                      className="text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-amber-400 rounded-lg px-2.5 py-1.5"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Half day before</span>
                    <input
                      type="time" value={defaultCheckoutCutoff} onChange={e => setDefaultCheckoutCutoff(e.target.value)}
                      className="text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-amber-400 rounded-lg px-2.5 py-1.5"
                    />
                  </label>
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-1.5 pl-6">
                {defaultEnabled
                  ? 'Check-ins after "Late after" are marked Late; check-outs before "Half day before" are marked Half Day. Applies to staff not covered by a group below.'
                  : 'The school-wide late/checkout cutoffs apply.'}
              </p>
            </div>

            {/* Contradiction warning + manual resolver */}
            {conflicts.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-red-700">
                    {conflicts.length} teacher{conflicts.length > 1 ? 's' : ''} landed in more than one group — choose one for each
                  </p>
                </div>
                <div className="space-y-1.5">
                  {conflicts.map(({ staffId, groupKeys }) => {
                    const staff = staffById.get(staffId)
                    return (
                      <div key={staffId} className="flex items-center justify-between gap-2 bg-white border border-red-100 rounded-lg px-2.5 py-1.5">
                        <span className="text-xs font-medium text-slate-700 truncate">{staff?.full_name ?? 'Unknown staff'}</span>
                        <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                          {groupKeys.map(gk => {
                            const g = groups.find(x => x.key === gk)
                            return (
                              <button
                                key={gk}
                                onClick={() => resolveConflict(staffId, gk, groupKeys)}
                                className="text-[10px] font-semibold px-2 py-1 border border-slate-200 text-slate-600 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 rounded-md transition-colors"
                              >
                                Keep in &quot;{g?.label || 'Group'}&quot;
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

            {/* Cutoff groups */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-slate-700">Cutoff groups</p>
                <button
                  onClick={addGroup}
                  className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 border border-dashed border-amber-300 px-2 py-1 rounded-lg transition-colors"
                >
                  <Plus size={11} /> Add group
                </button>
              </div>

              {groups.length === 0 ? (
                <p className="text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-lg px-3 py-3 text-center">
                  No groups yet. Add one to give a specific set of teachers a different late/checkout cutoff.
                </p>
              ) : (
                <div className="space-y-3">
                  {groups.map(g => {
                    const ids = [...effectiveIds(g)]
                    return (
                      <div key={g.key} className="border border-slate-200 rounded-xl p-3 space-y-2.5">
                        <div className="flex items-center gap-2">
                          <input
                            value={g.label}
                            onChange={e => updateGroup(g.key, { label: e.target.value })}
                            placeholder="Group name…"
                            className="flex-1 min-w-0 text-sm font-semibold border border-transparent hover:border-slate-200 focus:border-amber-400 bg-transparent focus:outline-none rounded-md px-1.5 py-1"
                          />
                          <button onClick={() => removeGroup(g.key)} className="p-1 text-slate-300 hover:text-red-500 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div className="flex items-center gap-3 pl-1.5">
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Late after</span>
                            <input
                              type="time" value={g.lateCutoff} onChange={e => updateGroup(g.key, { lateCutoff: e.target.value })}
                              className="text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-amber-400 rounded-lg px-2.5 py-1.5"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Half day before</span>
                            <input
                              type="time" value={g.checkoutCutoff} onChange={e => updateGroup(g.key, { checkoutCutoff: e.target.value })}
                              className="text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-amber-400 rounded-lg px-2.5 py-1.5"
                            />
                          </label>
                        </div>

                        <div className="pl-1.5">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                            <Users size={10} /> Filter by team
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {teams.map(t => {
                              const active = g.teamIds.includes(t.id)
                              return (
                                <button
                                  key={t.id}
                                  onClick={() => toggleTeam(g.key, t.id)}
                                  className={`text-[11px] font-medium px-2 py-1 border rounded-full transition-colors ${
                                    active ? 'bg-amber-600 text-white border-amber-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  {t.name}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className="pl-1.5">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                            {ids.length} teacher{ids.length === 1 ? '' : 's'} in this group
                          </p>
                          {ids.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {ids.map(id => {
                                const staff = staffById.get(id)
                                const conflicted = conflicts.some(c => c.staffId === id && c.groupKeys.includes(g.key))
                                return (
                                  <span
                                    key={id}
                                    className={`flex items-center gap-1 text-[11px] pl-2 pr-1 py-0.5 border rounded-full ${
                                      conflicted ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                                    }`}
                                  >
                                    {staff?.full_name ?? 'Unknown'}
                                    <button onClick={() => excludeStaff(g.key, id)} className="hover:text-red-600">
                                      <X size={10} />
                                    </button>
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}
          </div>

          <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100 flex-shrink-0">
            <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 rounded-xl transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
