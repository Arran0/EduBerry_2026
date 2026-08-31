'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Ban, Calendar, Users, Plus, Trash2, AlertTriangle, Loader2, Check } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import {
  NonWorkingDayGroup, NonWorkingDayGroupInput, fetchNonWorkingDaysForDate, saveNonWorkingDays,
} from '@/lib/attendance'
import { fetchTeamStaffById } from '@/lib/teams'

interface GroupDraft {
  key: string
  name: string
  teamIds: string[]
  manualIds: string[]
  excludedIds: string[]
}

let draftKeySeq = 0
function nextDraftKey() {
  draftKeySeq += 1
  return `nwd-draft-${draftKeySeq}`
}

const chipBase = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all'
const chipActive = 'bg-slate-700 text-white'
const chipInactive = 'bg-slate-100 text-slate-600 active:bg-slate-200'

interface Props {
  initialDate: string
  viewerId: string
  teams: { id: string; name: string }[]
  allStaff: UserProfile[]
  onClose: () => void
  onSaved: () => void
}

/**
 * A day that is genuinely not worked and not paid — distinct from a Holiday,
 * which is a paid day off. Structurally identical to HolidayModal (same
 * is_default + team-scoped-groups pattern), pointed at the
 * attendance_non_working_days table instead. Kept as a separate component
 * rather than a shared generalisation, matching how HolidayModal/
 * DayTimingModal/GeofenceZoneModal already exist as independent
 * implementations of the same pattern in this codebase.
 */
export default function NonWorkingDayModal({
  initialDate, viewerId, teams, allStaff, onClose, onSaved,
}: Props) {
  const [date, setDate] = useState(initialDate)
  const [applyMode, setApplyMode] = useState<'everyone' | 'teams'>('everyone')
  const [everyoneName, setEveryoneName] = useState('')
  const [groups, setGroups] = useState<GroupDraft[]>([])
  const [hasExistingRule, setHasExistingRule] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const teamCacheRef = useRef<Map<string, UserProfile[]>>(new Map())
  const [, forceRerender] = useState(0)

  const staffById = useMemo(() => new Map(allStaff.map(s => [s.id, s])), [allStaff])

  const loadExisting = useCallback(async (d: string) => {
    setLoadingExisting(true)
    const rules = await fetchNonWorkingDaysForDate(d)
    const everyoneRule = rules.find(r => r.is_default) ?? null
    const overrideRules = rules.filter(r => !r.is_default)

    setHasExistingRule(rules.length > 0)
    if (overrideRules.length > 0) {
      setApplyMode('teams')
      setGroups(overrideRules.map(g => ({
        key: nextDraftKey(),
        name: g.name,
        teamIds: [],
        manualIds: [...g.staff_ids],
        excludedIds: [],
      })))
      setEveryoneName('')
    } else if (everyoneRule) {
      setApplyMode('everyone')
      setEveryoneName(everyoneRule.name)
      setGroups([])
    } else {
      setApplyMode('everyone')
      setEveryoneName('')
      setGroups([])
    }
    setLoadingExisting(false)
  }, [])

  useEffect(() => { loadExisting(date) }, [date, loadExisting])

  const ensureTeamLoaded = useCallback((teamId: string) => {
    if (teamCacheRef.current.has(teamId)) return
    fetchTeamStaffById(teamId).then(members => {
      teamCacheRef.current.set(teamId, members.filter(m => !m.attendance_hidden))
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
    () => groups.map(g => ({ key: g.key, name: g.name, ids: effectiveIds(g) })),
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
      key: nextDraftKey(), name: `Group ${prev.length + 1}`, teamIds: [], manualIds: [], excludedIds: [],
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

  const canSave = !saving && !!date &&
    (applyMode === 'everyone'
      ? !!everyoneName.trim()
      : conflicts.length === 0 &&
        groups.some(g => effectiveIds(g).size > 0) &&
        groups.every(g => effectiveIds(g).size === 0 || (!!g.name.trim())))

  const handleSave = async () => {
    setError(null)
    if (!date) { setError('Pick a date.'); return }

    let payload: NonWorkingDayGroupInput[]
    if (applyMode === 'everyone') {
      if (!everyoneName.trim()) { setError('Give this non-working day a name.'); return }
      payload = [{ name: everyoneName.trim(), is_default: true, staff_ids: [] }]
    } else {
      if (conflicts.length > 0) { setError('Resolve the highlighted conflicts before saving.'); return }
      payload = []
      for (const g of groups) {
        const ids = [...effectiveIds(g)]
        if (ids.length === 0) continue
        if (!g.name.trim()) { setError(`Give "${g.name || 'this group'}" a name.`); return }
        payload.push({ name: g.name.trim(), is_default: false, staff_ids: ids })
      }
      if (payload.length === 0) { setError('Add at least one team, or switch to "Everyone".'); return }
    }

    setSaving(true)
    const ok = await saveNonWorkingDays(date, payload, viewerId)
    setSaving(false)
    if (ok) { onSaved(); onClose() } else { setError('Failed to save. Please try again.') }
  }

  const handleClear = async () => {
    setError(null)
    setSaving(true)
    const ok = await saveNonWorkingDays(date, [], viewerId)
    setSaving(false)
    if (ok) { onSaved(); onClose() } else { setError('Failed to clear. Please try again.') }
  }

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const tomorrowStr = useMemo(() => new Date(Date.now() + 86400000).toISOString().split('T')[0], [])
  const nextWeekStr = useMemo(() => new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0], [])

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
                style={{ background: 'linear-gradient(135deg, #64748b, #475569)' }}
              >
                <Ban size={18} className="relative z-10 text-white drop-shadow-sm" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-lg font-bold text-slate-800 leading-tight truncate">Non-working Day</h2>
                <p className="text-[11px] sm:text-xs text-slate-400 truncate">Whole school, or specific teams — unpaid</p>
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
          <div className="overflow-y-auto flex-1 px-4 sm:px-5 py-3 sm:py-4 space-y-5">
            {/* Date */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Calendar size={12} /> Date
              </label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: 'Today', value: todayStr },
                  { label: 'Tomorrow', value: tomorrowStr },
                  { label: 'Next Week', value: nextWeekStr },
                ].map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setDate(opt.value)}
                    className={`${chipBase} ${date === opt.value ? chipActive : chipInactive}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base sm:text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-400/50 focus:border-slate-500 transition-colors"
              />
            </div>

            {/* Apply to */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Users size={12} /> Apply to
              </label>
              <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setApplyMode('everyone')}
                  className={`py-1.5 rounded-md transition-all ${applyMode === 'everyone' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                >
                  Everyone
                </button>
                <button
                  type="button"
                  onClick={() => setApplyMode('teams')}
                  className={`py-1.5 rounded-md transition-all ${applyMode === 'teams' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                >
                  Specific teams
                </button>
              </div>

              {loadingExisting ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
                  <Loader2 size={13} className="animate-spin" /> Checking existing rule…
                </div>
              ) : applyMode === 'everyone' ? (
                <input
                  value={everyoneName}
                  onChange={e => setEveryoneName(e.target.value)}
                  placeholder="Reason — e.g. Semester break…"
                  autoFocus
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base sm:text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-400/50 focus:border-slate-500 transition-colors"
                />
              ) : (
                <div className="space-y-3">
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
                                      className="text-[10px] font-semibold px-2 py-1 border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700 rounded-md transition-colors"
                                    >
                                      Keep under &quot;{g?.name || 'Group'}&quot;
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

                  {groups.length === 0 ? (
                    <p className="text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-xl px-3 py-3 text-center">
                      No groups yet. Add one to make a specific set of teachers non-working.
                    </p>
                  ) : (
                    groups.map(g => {
                      const ids = [...effectiveIds(g)]
                      return (
                        <div key={g.key} className="border border-slate-200 rounded-xl p-3 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Team override</p>
                            <button onClick={() => removeGroup(g.key)} className="p-1 text-slate-300 hover:text-red-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-400 mb-1">Reason</p>
                            <input
                              value={g.name}
                              onChange={e => updateGroup(g.key, { name: e.target.value })}
                              placeholder="e.g. Transport staff off-cycle"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-400/50 focus:border-slate-500 transition-colors"
                            />
                          </div>

                          <div className="pl-1">
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
                                    className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
                                      active ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
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
                                  const conflicted = conflicts.some(c => c.staffId === id && c.groupKeys.includes(g.key))
                                  return (
                                    <span
                                      key={id}
                                      className={`flex items-center gap-1 text-[11px] pl-2 pr-1 py-0.5 rounded-full border ${
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
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}

                  <button
                    type="button"
                    onClick={addGroup}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
                  >
                    <Plus size={13} /> Add another team
                  </button>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}

            <div className="h-1" />
          </div>

          {/* Sticky footer */}
          <div
            className="flex items-center gap-2 px-4 sm:px-5 py-3 border-t border-slate-100 flex-shrink-0"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
          >
            {hasExistingRule && (
              <button
                type="button"
                onClick={handleClear}
                disabled={saving}
                title="Remove this non-working day"
                className="flex-shrink-0 p-3.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white font-semibold py-3.5 rounded-2xl transition-all disabled:opacity-50 text-sm shadow-lg shadow-slate-500/25 active:scale-[0.98]"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
