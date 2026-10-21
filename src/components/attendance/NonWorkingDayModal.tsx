'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Ban, Calendar, Repeat, Users, Plus, Trash2, AlertTriangle, Loader2, Check } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import {
  NonWorkingDayGroupInput, DayTimingScope, fetchNonWorkingDaysByScope, saveNonWorkingDays,
  recomputePendingAttendance,
} from '@/lib/attendance'
import { fetchTeamStaffById } from '@/lib/teams'
import { SHEET_MOTION } from '@/lib/sheetMotion'
import StaffAdder from '@/components/attendance/StaffAdder'

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] // index matches JS Date#getDay()

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
const chipActive = 'bg-[#3F3F46] text-white'
const chipInactive = 'bg-[#F5F5F5] text-[#52525B] active:bg-[#E4E4E7]'

interface Props {
  initialDate: string
  /** Opens the modal already scoped to an existing rule (e.g. editing from a management list). */
  initialScope?: DayTimingScope
  viewerId: string
  teams: { id: string; name: string }[]
  allStaff: UserProfile[]
  onClose: () => void
  onSaved: () => void
}

/**
 * A day that is genuinely not worked and not paid — distinct from a Holiday,
 * which is a paid day off. Structurally identical to HolidayModal (same
 * is_default + team-scoped-groups + date/weekday-scope pattern), pointed at
 * the attendance_non_working_days table instead. Kept as a separate
 * component rather than a shared generalisation, matching how HolidayModal/
 * DayTimingModal/GeofenceZoneModal already exist as independent
 * implementations of the same pattern in this codebase.
 */
export default function NonWorkingDayModal({
  initialDate, initialScope, viewerId, teams, allStaff, onClose, onSaved,
}: Props) {
  const [scopeKind, setScopeKind] = useState<'date' | 'weekday'>(initialScope?.type ?? 'date')
  const [scopeDate, setScopeDate] = useState(initialScope?.type === 'date' ? initialScope.date : initialDate)
  const [scopeWeekdays, setScopeWeekdays] = useState<number[]>(initialScope?.type === 'weekday' ? [initialScope.weekday] : [])

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

  const loadExistingForScope = useCallback(async (scope: DayTimingScope) => {
    setLoadingExisting(true)
    const rules = await fetchNonWorkingDaysByScope(scope)
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

  const singleWeekday = scopeKind === 'weekday' && scopeWeekdays.length === 1 ? scopeWeekdays[0] : null

  useEffect(() => {
    if (scopeKind === 'date') {
      loadExistingForScope({ type: 'date', date: scopeDate })
      return
    }
    if (singleWeekday !== null) {
      loadExistingForScope({ type: 'weekday', weekday: singleWeekday })
      return
    }
    setHasExistingRule(false)
    setApplyMode('everyone')
    setEveryoneName('')
    setGroups([])
  }, [scopeKind, scopeDate, singleWeekday, loadExistingForScope])

  const toggleWeekday = (d: number) =>
    setScopeWeekdays(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]))

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

  // A teacher picked by hand, on top of (or instead of) whole teams. Undoes an
  // earlier removal of the same person, so the two never disagree.
  const includeStaff = (groupKey: string, staffId: string) => {
    setGroups(prev => prev.map(g => (g.key === groupKey
      ? { ...g, manualIds: [...new Set([...g.manualIds, staffId])], excludedIds: g.excludedIds.filter(id => id !== staffId) }
      : g)))
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

  // ── Scopes this save/clear should apply to ──────────────────────────────────
  const activeScopes = useMemo((): DayTimingScope[] => (
    scopeKind === 'date'
      ? [{ type: 'date', date: scopeDate }]
      : scopeWeekdays.map(w => ({ type: 'weekday', weekday: w }))
  ), [scopeKind, scopeDate, scopeWeekdays])

  const canSave = !saving && activeScopes.length > 0 &&
    (applyMode === 'everyone'
      ? !!everyoneName.trim()
      : conflicts.length === 0 &&
        groups.some(g => effectiveIds(g).size > 0) &&
        groups.every(g => effectiveIds(g).size === 0 || (!!g.name.trim())))

  const handleSave = async () => {
    setError(null)
    if (activeScopes.length === 0) { setError('Pick a date, or at least one weekday to repeat on.'); return }

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
      if (payload.length === 0) { setError('Add at least one team or teacher, or switch to "Everyone".'); return }
    }

    setSaving(true)
    const results = await Promise.all(activeScopes.map(scope => saveNonWorkingDays(scope, payload, viewerId)))
    if (!results.every(Boolean)) { setSaving(false); setError('Failed to save. Please try again.'); return }
    // A day nobody was expected to work has no cutoffs in force, so anyone who
    // did come in is re-derived to Present instead of keeping a Late or Half Day
    // scored against a timetable that no longer applies to it.
    await recomputePendingAttendance()
    setSaving(false)
    onSaved(); onClose()
  }

  const handleClear = async () => {
    if (activeScopes.length === 0) return
    setError(null)
    setSaving(true)
    const results = await Promise.all(activeScopes.map(scope => saveNonWorkingDays(scope, [], viewerId)))
    if (!results.every(Boolean)) { setSaving(false); setError('Failed to clear. Please try again.'); return }
    // The day is a working day again, so its cutoffs apply again.
    await recomputePendingAttendance()
    setSaving(false)
    onSaved(); onClose()
  }

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const tomorrowStr = useMemo(() => new Date(Date.now() + 86400000).toISOString().split('T')[0], [])
  const nextWeekStr = useMemo(() => new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0], [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4 bg-[#18181B]/50"
        onClick={onClose}
      >
        <motion.div
          {...SHEET_MOTION} // slides, never fades — see lib/sheetMotion
          className="relative bg-white border border-[#D4D4D8] w-full sm:max-w-xl flex flex-col overflow-hidden shadow-[0_24px_60px_-20px_rgba(24,24,27,.55)]"
          style={{ maxHeight: '92dvh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Drag handle — mobile only */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
            <div className="w-10 h-1.5 rounded-full bg-[#D4D4D8]" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between gap-2 relative z-[3] px-4 sm:px-5 py-3 sm:py-4 flex-shrink-0 border-b border-[#E4E4E7]">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[#27272A] flex items-center justify-center flex-shrink-0">
                <Ban size={18} className="text-[#B8983C]" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-[1.05rem] sm:text-[1.15rem] font-bold text-[#18181B] leading-tight headline truncate">Non-working Day</h2>
                <p className="text-[11px] sm:text-xs text-[#A1A1AA] truncate">Whole school, teams or individual teachers — unpaid</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-[#71717A] hover:text-[#18181B] hover:bg-[#F5F5F5] border border-[#E4E4E7] transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="relative z-[3] overflow-y-auto overscroll-contain flex-1 px-4 sm:px-5 py-4 space-y-5 bg-[#FDFCF9]">
            {/* When */}
            <div className="space-y-2">
              <label className="text-[12.5px] font-semibold text-[#52525B] flex items-center gap-1.5">
                <Calendar size={12} /> When
              </label>
              <div className="grid grid-cols-2 gap-1 bg-[#F5F5F5] rounded-lg p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setScopeKind('date')}
                  className={`py-1.5 rounded-md transition-all ${scopeKind === 'date' ? 'bg-white text-[#3F3F46] shadow-sm' : 'text-[#A1A1AA]'}`}
                >
                  This date
                </button>
                <button
                  type="button"
                  onClick={() => setScopeKind('weekday')}
                  className={`py-1.5 rounded-md transition-all flex items-center justify-center gap-1 ${scopeKind === 'weekday' ? 'bg-white text-[#3F3F46] shadow-sm' : 'text-[#A1A1AA]'}`}
                >
                  <Repeat size={11} /> Every week
                </button>
              </div>

              {scopeKind === 'date' ? (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: 'Today', value: todayStr },
                      { label: 'Tomorrow', value: tomorrowStr },
                      { label: 'Next Week', value: nextWeekStr },
                    ].map(opt => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => setScopeDate(opt.value)}
                        className={`${chipBase} ${scopeDate === opt.value ? chipActive : chipInactive}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="date"
                    value={scopeDate}
                    onChange={e => setScopeDate(e.target.value)}
                    className="w-full border border-[#E4E4E7] rounded-lg px-4 py-3 text-base sm:text-sm bg-[#F5F5F5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A1A1AA]/50 focus:border-[#71717A] transition-colors"
                  />
                </>
              ) : (
                <>
                  <div className="grid grid-cols-7 gap-1.5">
                    {WEEKDAY_SHORT.map((label, i) => {
                      const active = scopeWeekdays.includes(i)
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleWeekday(i)}
                          className={`py-2 rounded-lg text-xs font-medium transition-all border ${
                            active
                              ? 'bg-[#3F3F46] text-white border-[#3F3F46] shadow-sm'
                              : 'bg-[#F5F5F5] text-[#52525B] border-[#E4E4E7] active:bg-[#F5F5F5]'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-[#A1A1AA] pl-0.5">
                    {scopeWeekdays.length === 0
                      ? 'Pick one or more days — the rule repeats on those days every week.'
                      : 'A specific date’s rule (if any) still wins over this repeating rule for that day.'}
                  </p>
                </>
              )}
            </div>

            {/* Apply to */}
            <div className="space-y-2">
              <label className="text-[12.5px] font-semibold text-[#52525B] flex items-center gap-1.5">
                <Users size={12} /> Apply to
              </label>
              <div className="grid grid-cols-2 gap-1 bg-[#F5F5F5] rounded-lg p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setApplyMode('everyone')}
                  className={`py-1.5 rounded-md transition-all ${applyMode === 'everyone' ? 'bg-white text-[#3F3F46] shadow-sm' : 'text-[#A1A1AA]'}`}
                >
                  Everyone
                </button>
                <button
                  type="button"
                  onClick={() => setApplyMode('teams')}
                  className={`py-1.5 rounded-md transition-all ${applyMode === 'teams' ? 'bg-white text-[#3F3F46] shadow-sm' : 'text-[#A1A1AA]'}`}
                >
                  Teams &amp; teachers
                </button>
              </div>

              {loadingExisting ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#A1A1AA]">
                  <Loader2 size={13} className="animate-spin" /> Checking existing rule…
                </div>
              ) : applyMode === 'everyone' ? (
                <input
                  value={everyoneName}
                  onChange={e => setEveryoneName(e.target.value)}
                  placeholder="Reason — e.g. Semester break…"
                  autoFocus
                  className="w-full border border-[#E4E4E7] rounded-lg px-4 py-3 text-base sm:text-sm bg-[#F5F5F5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A1A1AA]/50 focus:border-[#71717A] transition-colors"
                />
              ) : (
                <div className="space-y-3">
                  {conflicts.length > 0 && (
                    <div className="border border-[#B8983C]/50 border-l-4 border-l-[#B8983C] bg-white p-3 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={14} className="text-[#B8983C] flex-shrink-0" />
                        <p className="text-xs font-semibold text-[#27272A]">
                          {conflicts.length} teacher{conflicts.length > 1 ? 's' : ''} landed in more than one group — choose one for each
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        {conflicts.map(({ staffId, groupKeys }) => {
                          const staff = staffById.get(staffId)
                          return (
                            <div key={staffId} className="flex items-center justify-between gap-2 bg-[#F5F5F5] border border-[#E4E4E7] rounded-lg px-2.5 py-1.5">
                              <span className="text-xs font-medium text-[#3F3F46] truncate">{staff?.full_name ?? 'Unknown staff'}</span>
                              <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                                {groupKeys.map(gk => {
                                  const g = groups.find(x => x.key === gk)
                                  return (
                                    <button
                                      key={gk}
                                      onClick={() => resolveConflict(staffId, gk, groupKeys)}
                                      className="text-[10px] font-semibold px-2 py-1 border border-[#E4E4E7] text-[#52525B] hover:bg-[#F5F5F5] hover:border-[#D4D4D8] hover:text-[#3F3F46] rounded-md transition-colors"
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
                    <p className="text-[11px] text-[#A1A1AA] border border-dashed border-[#E4E4E7] rounded-lg px-3 py-3 text-center">
                      No groups yet. Add one to make a specific set of teachers non-working.
                    </p>
                  ) : (
                    groups.map(g => {
                      const ids = [...effectiveIds(g)]
                      return (
                        <div key={g.key} className="bg-white border border-[#E4E4E7] p-3 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11.5px] font-semibold text-[#71717A]">Group</p>
                            <button onClick={() => removeGroup(g.key)} className="p-1 text-[#D4D4D8] hover:text-[#27272A] transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div>
                            <p className="text-[11px] text-[#A1A1AA] mb-1">Reason</p>
                            <input
                              value={g.name}
                              onChange={e => updateGroup(g.key, { name: e.target.value })}
                              placeholder="e.g. Transport staff off-cycle"
                              className="w-full border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm font-medium bg-[#F5F5F5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A1A1AA]/50 focus:border-[#71717A] transition-colors"
                            />
                          </div>

                          <div className="pl-1">
                            <p className="text-[11.5px] font-semibold text-[#71717A] mb-1 flex items-center gap-1">
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
                                      active ? 'bg-[#3F3F46] text-white border-[#3F3F46]' : 'border-[#E4E4E7] text-[#52525B] hover:bg-[#F5F5F5]'
                                    }`}
                                  >
                                    {t.name}
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          <div className="pl-1">
                            <p className="text-[10px] text-[#A1A1AA] mb-1">Add individual teachers</p>
                            <StaffAdder allStaff={allStaff} selectedIds={new Set(ids)} onAdd={id => includeStaff(g.key, id)} />
                          </div>

                          {ids.length > 0 && (
                            <div className="pl-1">
                              <p className="text-[10px] text-[#A1A1AA] mb-1">
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
                                        conflicted ? 'bg-[#FDFCF9] border-[#B8983C] text-[#27272A]' : 'bg-[#F5F5F5] border-[#E4E4E7] text-[#52525B]'
                                      }`}
                                    >
                                      {staff?.full_name ?? 'Unknown'}
                                      <button onClick={() => excludeStaff(g.key, id)} className="hover:text-[#27272A]">
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
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-[#D4D4D8] text-[#3F3F46] text-xs font-semibold hover:bg-[#F5F5F5] transition-colors"
                  >
                    <Plus size={13} /> Add another group
                  </button>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-[#27272A] bg-white border border-[#E4E4E7] border-l-4 border-l-[#B8983C] px-3 py-2">{error}</p>}

            <div className="h-1" />
          </div>

          {/* Sticky footer */}
          <div
            className="relative z-[3] flex items-center gap-2 px-4 sm:px-5 py-3 flex-shrink-0 border-t border-[#E4E4E7] bg-white"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
          >
            {hasExistingRule && (
              <button
                type="button"
                onClick={handleClear}
                disabled={saving}
                title="Remove this non-working day"
                className="flex-shrink-0 p-3 text-[#A1A1AA] hover:text-[#F5F5F5] hover:bg-[#27272A] border border-[#E4E4E7] rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#27272A] hover:bg-[#18181B] border-b-2 border-[#B8983C] text-[#F5F5F5] font-semibold py-3 transition-colors disabled:opacity-50 text-sm"
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
