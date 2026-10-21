'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Attendance rules — how a staff check-in is scored.
//
//   Timing           — the school-wide late and checkout cutoffs.
//   Exceptions       — cutoff overrides, holidays and non-working days, each
//                      for one date or repeating on a weekday.
//   Who is tracked   — the people left out of attendance lists and counts.
//
// Was the Attendance tab of App Settings; it is its own page in Admin Space
// now. Geofence exemptions moved to the Geofencing page, beside the fence they
// exempt people from.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Ban, CalendarOff, Clock, Clock3, EyeOff, Loader2, Pencil, Plus, Repeat, Trash2, Users, CalendarClock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { ATTENDANCE_RULES_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  fetchAttendanceConfig, saveAttendanceConfig, AttendanceConfig,
  fetchAllStaff, setStaffAttendanceVisibility,
  fetchAllDayTimingRules, fetchAllTrackedStaff, saveDayTimings,
  DayTimingScope, DayTimingScopeType,
  fetchAllHolidayRules, saveHolidays,
  fetchAllNonWorkingDayRules, saveNonWorkingDays,
  recomputePendingAttendance,
  DayTimingGroup, HolidayGroup, NonWorkingDayGroup,
} from '@/lib/attendance'
import { fetchTeamsForDropdown } from '@/lib/teams'
import { UserProfile } from '@/lib/supabase'
import { AdminPage, AX, EmptyLine, Field, Panel, PageLoading, SaveButton, SearchField, Switch } from '@/components/admin/ui'

const DayTimingModal = dynamic(() => import('@/components/attendance/DayTimingModal'), { ssr: false })
const HolidayModal = dynamic(() => import('@/components/attendance/HolidayModal'), { ssr: false })
const NonWorkingDayModal = dynamic(() => import('@/components/attendance/NonWorkingDayModal'), { ssr: false })

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function scopeKey(scope: DayTimingScope): string {
  return scope.type === 'weekday' ? `weekday-${scope.weekday}` : `date-${scope.date}`
}

interface ScopeGroup<T> {
  scope: DayTimingScope
  key: string
  label: string
  rows: T[]
}

// One row per rule in the DB, but the UI manages a whole scope (date or weekday)
// as a single unit — group rows back together for display. Shared by cutoffs,
// holidays and non-working days: all three use the same date/weekday split (a
// rule either applies to one exact date, or repeats every week on a given
// weekday — see add_attendance_holiday_weekday_scope.sql).
function groupRulesByScope<T extends { scope_type: DayTimingScopeType; scope_date: string | null; scope_weekday: number | null }>(
  rules: T[]
): ScopeGroup<T>[] {
  const map = new Map<string, ScopeGroup<T>>()
  for (const r of rules) {
    const scope: DayTimingScope = r.scope_type === 'weekday'
      ? { type: 'weekday', weekday: r.scope_weekday as number }
      : { type: 'date', date: r.scope_date as string }
    const key = scopeKey(scope)
    if (!map.has(key)) {
      const label = scope.type === 'weekday'
        ? `Every ${WEEKDAY_NAMES[scope.weekday]}`
        : new Date(scope.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      map.set(key, { scope, key, label, rows: [] })
    }
    map.get(key)!.rows.push(r)
  }
  return [...map.values()]
}

type Editing = { kind: 'timing' | 'holiday' | 'nonworking'; scope: DayTimingScope | null } | null

export default function AttendanceRulesPage() {
  return (
    <ProtectedLayout adminOnly>
      <AdminPage
        settingKey="attendance_rules_banner"
        defaultBanner={ATTENDANCE_RULES_BANNER_DEFAULT}
        icon={Clock}
        backgroundIcon={CalendarClock}
        title="Attendance rules"
        subtitle="Cutoffs, holidays, non-working days and who is tracked"
        maxWidth="max-w-6xl"
      >
        <AttendanceBody />
      </AdminPage>
    </ProtectedLayout>
  )
}

function AttendanceBody() {
  const { profile } = useAuth()

  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState<AttendanceConfig>({ late_cutoff: null, checkout_cutoff: null })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [staff, setStaff] = useState<UserProfile[]>([])
  const [hideQuery, setHideQuery] = useState('')
  const [hideSaving, setHideSaving] = useState<string | null>(null)

  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [trackedStaff, setTrackedStaff] = useState<UserProfile[]>([])
  const [timingRules, setTimingRules] = useState<DayTimingGroup[]>([])
  const [holidayRules, setHolidayRules] = useState<HolidayGroup[]>([])
  const [nonWorkingRules, setNonWorkingRules] = useState<NonWorkingDayGroup[]>([])

  const [editing, setEditing] = useState<Editing>(null)
  const [clearingKey, setClearingKey] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchAttendanceConfig(), fetchAllStaff(),
      fetchAllDayTimingRules(), fetchTeamsForDropdown(), fetchAllTrackedStaff(),
      fetchAllHolidayRules(), fetchAllNonWorkingDayRules(),
    ]).then(([cfg, s, rules, t, tracked, hol, nonWorking]) => {
      setDraft(cfg); setStaff(s)
      setTimingRules(rules); setTeams(t); setTrackedStaff(tracked)
      setHolidayRules(hol); setNonWorkingRules(nonWorking)
      setLoaded(true)
    })
  }, [])

  async function handleSaveTiming() {
    setSaving(true)
    await saveAttendanceConfig(draft)
    // These are the cutoffs every day without an override is scored against, so
    // moving them leaves the Late / Half Day statuses on all of those days
    // decided by a rule that no longer exists. Re-derive them.
    await recomputePendingAttendance()
    setSaving(false)
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  const reloadTiming = async () => setTimingRules(await fetchAllDayTimingRules())
  const reloadHolidays = async () => setHolidayRules(await fetchAllHolidayRules())
  const reloadNonWorking = async () => setNonWorkingRules(await fetchAllNonWorkingDayRules())

  // Clearing any of the three changes how the days it covered are scored — they
  // fall back to the school-wide cutoffs, or become working days again — so the
  // statuses scored under it have to be re-derived.
  async function handleClear(kind: 'timing' | 'holiday' | 'nonworking', scope: DayTimingScope) {
    if (!profile) return
    const key = `${kind}:${scopeKey(scope)}`
    setClearingKey(key)
    const save = kind === 'timing' ? saveDayTimings : kind === 'holiday' ? saveHolidays : saveNonWorkingDays
    const ok = await save(scope, [], profile.id)
    if (ok) {
      await recomputePendingAttendance()
      await (kind === 'timing' ? reloadTiming() : kind === 'holiday' ? reloadHolidays() : reloadNonWorking())
    }
    setClearingKey(null)
  }

  async function handleToggleHidden(s: UserProfile) {
    setHideSaving(s.id)
    const next = !s.attendance_hidden
    const ok = await setStaffAttendanceVisibility(s.id, next)
    if (ok) setStaff(prev => prev.map(p => p.id === s.id ? { ...p, attendance_hidden: next } : p))
    setHideSaving(null)
  }

  const filteredHide = useMemo(() => {
    const q = hideQuery.trim().toLowerCase()
    const list = q ? staff.filter(s => s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)) : staff
    return [...list].sort((a, b) => Number(!!b.attendance_hidden) - Number(!!a.attendance_hidden))
  }, [staff, hideQuery])
  const hiddenCount = staff.filter(s => s.attendance_hidden).length

  if (!loaded) return <PageLoading>Loading attendance rules…</PageLoading>

  const timingGroups = groupRulesByScope(timingRules)
  const holidayGroups = groupRulesByScope(holidayRules)
  const nonWorkingGroups = groupRulesByScope(nonWorkingRules)
  const today = new Date().toISOString().split('T')[0]
  const close = () => setEditing(null)

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Timing — the default every day is scored against. */}
      <Panel
        icon={Clock3}
        title="Timing"
        description={<>A check-in after the late cutoff is marked <strong className="font-semibold text-slate-700">Late</strong>; a checkout before the checkout cutoff is a <strong className="font-semibold text-slate-700">Half day</strong>. The cutoff minute itself is on time, by the server&apos;s clock.</>}
      >
        <div className="flex flex-wrap items-end gap-3">
          <TimeField
            label="Late after"
            value={draft.late_cutoff}
            onChange={v => setDraft(d => ({ ...d, late_cutoff: v }))}
          />
          <TimeField
            label="Half day before"
            value={draft.checkout_cutoff}
            onChange={v => setDraft(d => ({ ...d, checkout_cutoff: v }))}
          />
          <SaveButton saving={saving} saved={saved} label="Save timing" onClick={handleSaveTiming} className="ml-auto" />
        </div>
      </Panel>

      {/* Exceptions to it. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 items-start">
        <RulePanel
          icon={Clock}
          title="Cutoff overrides"
          description="Different cutoffs for one date or a weekday, for everyone or chosen teams."
          addLabel="Add override"
          emptyIcon={Clock}
          emptyText="No overrides. Every day uses the timing above."
          groups={timingGroups.map(g => {
            const everyone = g.rows.find(r => r.is_default)
            const teamCount = g.rows.filter(r => !r.is_default).length
            return {
              key: g.key, scope: g.scope, label: g.label,
              detail: everyone
                ? `Late after ${everyone.late_cutoff.slice(0, 5)}, half day before ${everyone.checkout_cutoff.slice(0, 5)}${teamCount ? ` · ${teamCount} team ${teamCount === 1 ? 'override' : 'overrides'}` : ''}`
                : `${teamCount} team ${teamCount === 1 ? 'override' : 'overrides'}`,
            }
          })}
          dateIcon={Clock}
          clearingKey={clearingKey}
          kind="timing"
          onAdd={() => setEditing({ kind: 'timing', scope: null })}
          onEdit={scope => setEditing({ kind: 'timing', scope })}
          onClear={scope => handleClear('timing', scope)}
        />
        <RulePanel
          icon={CalendarOff}
          title="Holidays"
          description="Days off. Nobody covered is marked absent, and the day is still paid."
          addLabel="Add holiday"
          emptyIcon={CalendarOff}
          emptyText="No holidays declared."
          groups={holidayGroups.map(g => {
            const everyone = g.rows.find(r => r.is_default)
            const teamCount = g.rows.filter(r => !r.is_default).length
            return {
              key: g.key, scope: g.scope, label: g.label,
              detail: everyone ? everyone.name : `${teamCount} team ${teamCount === 1 ? 'holiday' : 'holidays'}`,
            }
          })}
          dateIcon={CalendarOff}
          clearingKey={clearingKey}
          kind="holiday"
          onAdd={() => setEditing({ kind: 'holiday', scope: null })}
          onEdit={scope => setEditing({ kind: 'holiday', scope })}
          onClear={scope => handleClear('holiday', scope)}
        />
        <RulePanel
          icon={Ban}
          title="Non-working days"
          description="Days that are neither worked nor paid. They lower the working-day count for payroll."
          addLabel="Add day"
          emptyIcon={Ban}
          emptyText="No non-working days declared."
          groups={nonWorkingGroups.map(g => {
            const everyone = g.rows.find(r => r.is_default)
            const teamCount = g.rows.filter(r => !r.is_default).length
            return {
              key: g.key, scope: g.scope, label: g.label,
              detail: everyone ? everyone.name : `${teamCount} team non-working ${teamCount === 1 ? 'day' : 'days'}`,
            }
          })}
          dateIcon={Ban}
          clearingKey={clearingKey}
          kind="nonworking"
          onAdd={() => setEditing({ kind: 'nonworking', scope: null })}
          onEdit={scope => setEditing({ kind: 'nonworking', scope })}
          onClear={scope => handleClear('nonworking', scope)}
        />
      </div>
      <p className="text-[12px] text-slate-500 px-1">
        The same three controls sit next to each date on the Staff Attendance page.
      </p>

      {/* Who is tracked. */}
      <Panel
        icon={EyeOff}
        title="Who is tracked"
        description={<>Everyone, admins included, appears in attendance lists and counts. Switch on the people who shouldn&apos;t. <span className="tabular-nums">{hiddenCount}</span> hidden.</>}
      >
        <div className="sm:max-w-sm">
          <SearchField value={hideQuery} onChange={setHideQuery} placeholder="Search staff" />
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[28rem] overflow-y-auto overscroll-contain pr-0.5">
          {filteredHide.length === 0 ? (
            <div className="md:col-span-2"><EmptyLine icon={Users}>No staff match your search.</EmptyLine></div>
          ) : filteredHide.map(s => (
            <div key={s.id} className={AX.row}>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium text-slate-900 truncate">{s.full_name}</p>
                <p className="text-[11.5px] text-slate-500 truncate"><span className="capitalize">{s.role}</span> · {s.email}</p>
              </div>
              {s.attendance_hidden && <span className="text-[11px] font-semibold text-[#B83A3A] flex-shrink-0">Hidden</span>}
              <Switch
                on={!!s.attendance_hidden}
                disabled={hideSaving === s.id}
                label={`Hide ${s.full_name} from attendance`}
                onChange={() => handleToggleHidden(s)}
              />
            </div>
          ))}
        </div>
      </Panel>

      {editing?.kind === 'timing' && profile && (
        <DayTimingModal
          initialDate={today}
          initialScope={editing.scope ?? undefined}
          viewerId={profile.id}
          teams={teams}
          allStaff={trackedStaff}
          onClose={close}
          onSaved={() => { reloadTiming(); close() }}
        />
      )}
      {editing?.kind === 'holiday' && profile && (
        <HolidayModal
          initialDate={today}
          initialScope={editing.scope ?? undefined}
          viewerId={profile.id}
          teams={teams}
          allStaff={trackedStaff}
          onClose={close}
          onSaved={() => { reloadHolidays(); close() }}
        />
      )}
      {editing?.kind === 'nonworking' && profile && (
        <NonWorkingDayModal
          initialDate={today}
          initialScope={editing.scope ?? undefined}
          viewerId={profile.id}
          teams={teams}
          allStaff={trackedStaff}
          onClose={close}
          onSaved={() => { reloadNonWorking(); close() }}
        />
      )}
    </div>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <input
          type="time" value={value ?? ''} onChange={e => onChange(e.target.value || null)}
          className={`${AX.field} !w-36 tabular-nums`}
        />
        {value && (
          <button onClick={() => onChange(null)} className="text-[12px] font-medium text-slate-500 hover:text-slate-900 px-1.5 transition-colors">
            Clear
          </button>
        )}
      </div>
    </Field>
  )
}

function RulePanel({
  icon, title, description, addLabel, emptyIcon, emptyText, groups, dateIcon: DateIcon, clearingKey, kind, onAdd, onEdit, onClear,
}: {
  icon: LucideIcon
  title: string
  description: string
  addLabel: string
  emptyIcon: LucideIcon
  emptyText: string
  groups: { key: string; scope: DayTimingScope; label: string; detail: string }[]
  dateIcon: LucideIcon
  clearingKey: string | null
  kind: string
  onAdd: () => void
  onEdit: (scope: DayTimingScope) => void
  onClear: (scope: DayTimingScope) => void
}) {
  return (
    <Panel
      icon={icon}
      title={title}
      description={description}
    >
      {groups.length === 0 ? (
        <EmptyLine icon={emptyIcon}>{emptyText}</EmptyLine>
      ) : (
        <ul className="space-y-1.5 max-h-80 overflow-y-auto overscroll-contain pr-0.5">
          {groups.map(g => {
            const clearing = clearingKey === `${kind}:${g.key}`
            return (
              <li key={g.key} className={`${AX.row} !items-start`}>
                <span className="mt-0.5 text-[#8B6F47] flex-shrink-0">
                  {g.scope.type === 'weekday' ? <Repeat size={14} /> : <DateIcon size={14} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-slate-900">{g.label}</p>
                  <p className="text-[12px] text-slate-500 leading-snug break-words">{g.detail}</p>
                </div>
                <div className="flex items-center -my-1 -mr-1.5">
                  <button onClick={() => onEdit(g.scope)} aria-label={`Edit ${g.label}`} className={AX.icon}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => onClear(g.scope)} disabled={clearing} aria-label={`Remove ${g.label}`} className={AX.iconDanger}>
                    {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <button
        onClick={onAdd}
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-[14px] text-[13px] font-semibold text-[#6B5536] hover:bg-[#F7F5F1] active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
      >
        <Plus size={14} /> {addLabel}
      </button>
    </Panel>
  )
}
