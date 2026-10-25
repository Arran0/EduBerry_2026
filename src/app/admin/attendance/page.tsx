'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Attendance rules, in two halves.
//
// Staff — how a staff check-in is scored:
//   Timing           — the school-wide late and checkout cutoffs.
//   Exceptions       — cutoff overrides, holidays and non-working days, each
//                      for one date or repeating on a weekday.
//   Groups           — named slices of the staff, each able to keep its own
//                      holiday calendar.
//   Calendars        — whole-year holiday lists, typed in or uploaded.
//   Who is tracked   — the people left out of attendance lists and counts.
//
// Students — the class register:
//   Groups           — named sets of homerooms (a wing, a grade band, a shift).
//   Calendars        — holiday lists for every class or chosen groups; the
//                      register shows the holiday on those days.
//
// Was the Attendance tab of App Settings; it is its own page in Admin Space
// now. Geofence exemptions moved to the Geofencing page, beside the fence they
// exempt people from.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { X, Ban, CalendarOff, Clock, Clock3, EyeOff, Loader2, Pencil, Plus, Repeat, Trash2, Users, CalendarClock, Briefcase, GraduationCap } from 'lucide-react'
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
import { fetchAllHomerooms, Homeroom } from '@/lib/homerooms'
import { UserProfile } from '@/lib/supabase'
import {
  AttendanceAudience, AttendanceGroup, HolidayCalendar, fetchAttendanceGroups, fetchHolidayCalendars,
} from '@/lib/attendanceCalendars'
import { AdminPage, AX, EmptyLine, Panel, PageLoading, SaveButton, SearchField, Switch } from '@/components/admin/ui'
import AttendanceGroupsPanel from '@/components/attendance/AttendanceGroupsPanel'
import HolidayCalendarsPanel from '@/components/attendance/HolidayCalendarsPanel'

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
        subtitle="Staff and student attendance: timing, groups and holiday calendars"
        maxWidth="max-w-[1800px]"
      >
        <AttendanceHalves />
      </AdminPage>
    </ProtectedLayout>
  )
}

const HALF_STORAGE_KEY = 'attendance-rules-half'

/** The Staff / Student switch. The choice is remembered per browser, and `?for=student` opens on the student half. */
function AttendanceHalves() {
  const [half, setHalf] = useState<AttendanceAudience>('staff')

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('for')
    if (fromUrl === 'student' || fromUrl === 'staff') { setHalf(fromUrl); return }
    try {
      const stored = localStorage.getItem(HALF_STORAGE_KEY)
      if (stored === 'student' || stored === 'staff') setHalf(stored)
    } catch { /* storage blocked — stay on staff */ }
  }, [])

  function choose(next: AttendanceAudience) {
    setHalf(next)
    try { localStorage.setItem(HALF_STORAGE_KEY, next) } catch { /* not remembered, still switched */ }
  }

  const tabs: { key: AttendanceAudience; label: string; short: string; icon: typeof Briefcase }[] = [
    { key: 'staff', label: 'Staff attendance', short: 'Staff', icon: Briefcase },
    { key: 'student', label: 'Student attendance', short: 'Students', icon: GraduationCap },
  ]

  return (
    <div className="space-y-4 sm:space-y-5">
      <div role="tablist" aria-label="Attendance settings for" className={`${AX.sheet} p-1 grid grid-cols-2 gap-1 sm:inline-grid sm:w-auto`}>
        {tabs.map(t => {
          const on = half === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => choose(t.key)}
              className={`inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg text-[13.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
                on ? 'bg-[#27272A] text-[#F5F5F5] border-b-2 border-[#B8983C]' : 'text-[#52525B] hover:bg-[#F5F5F5]'
              }`}
            >
              <Icon size={15} className={on ? 'text-[#B8983C]' : 'text-[#A1A1AA]'} />
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.short}</span>
            </button>
          )
        })}
      </div>
      {half === 'staff' ? <StaffAttendanceBody /> : <StudentAttendanceBody />}
    </div>
  )
}

/** Groups and holiday calendars for one audience, loaded together and reloaded after any change. */
function useGroupsAndCalendars(audience: AttendanceAudience) {
  const [groups, setGroups] = useState<AttendanceGroup[]>([])
  const [calendars, setCalendars] = useState<HolidayCalendar[]>([])
  const [loaded, setLoaded] = useState(false)
  const reload = async () => {
    const [g, c] = await Promise.all([fetchAttendanceGroups(audience), fetchHolidayCalendars(audience)])
    setGroups(g); setCalendars(c); setLoaded(true)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [audience])
  return { groups, calendars, loaded, reload }
}

function StudentAttendanceBody() {
  const { profile } = useAuth()
  const { groups, calendars, loaded, reload } = useGroupsAndCalendars('student')
  const [homerooms, setHomerooms] = useState<Homeroom[] | null>(null)

  useEffect(() => { fetchAllHomerooms().then(setHomerooms) }, [])

  if (!loaded || !homerooms || !profile) return <PageLoading>Loading student attendance settings…</PageLoading>

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch">
        <AttendanceGroupsPanel audience="student" groups={groups} homerooms={homerooms} viewerId={profile.id} onChanged={reload} />
        <HolidayCalendarsPanel audience="student" calendars={calendars} groups={groups} viewerId={profile.id} onChanged={reload} />
      </div>
      <p className="text-[12px] text-[#71717A] px-1">
        Teachers still open the register on a holiday, but it tells them the day is off. Groups follow homerooms, so a student moved to another class moves with it.
      </p>
    </div>
  )
}

function StaffAttendanceBody() {
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

  const staffGroups = useGroupsAndCalendars('staff')

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

  if (!loaded || !staffGroups.loaded) return <PageLoading>Loading attendance rules…</PageLoading>

  const timingGroups = groupRulesByScope(timingRules)
  const holidayGroups = groupRulesByScope(holidayRules)
  const nonWorkingGroups = groupRulesByScope(nonWorkingRules)
  const today = new Date().toISOString().split('T')[0]
  const close = () => setEditing(null)

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* One row across the full width: the timing every day is scored
          against, then the three kinds of exception to it, all one height. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 items-stretch">
        <Panel
          icon={Clock3}
          title="Timing"
          className="h-full"
          description={<>Checking in after the first is <strong className="font-semibold text-[#3F3F46]">Late</strong>; leaving before the second is a <strong className="font-semibold text-[#3F3F46]">Half day</strong>. The cutoff minute itself is on time.</>}
        >
          {/* One field per line: side by side, the labels wrap and the times crowd. */}
          <div className="space-y-3">
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
          </div>
          <SaveButton saving={saving} saved={saved} label="Save timing" onClick={handleSaveTiming} className="mt-4 w-full" />
        </Panel>

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
      <p className="text-[12px] text-[#71717A] px-1">
        The same three controls sit next to each date on the Staff Attendance page.
      </p>

      {/* Groups, and the holiday calendars given to everyone or to groups. */}
      {profile && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch">
          <AttendanceGroupsPanel
            audience="staff"
            groups={staffGroups.groups}
            staff={trackedStaff}
            teams={teams}
            viewerId={profile.id}
            onChanged={staffGroups.reload}
          />
          <HolidayCalendarsPanel
            audience="staff"
            calendars={staffGroups.calendars}
            groups={staffGroups.groups}
            viewerId={profile.id}
            onChanged={staffGroups.reload}
          />
        </div>
      )}

      {/* Who is tracked. */}
      <Panel
        icon={EyeOff}
        title="Who is tracked"
        description={<>Everyone, admins included, appears in attendance lists and counts. Switch on the people who shouldn&apos;t. <span className="tabular-nums">{hiddenCount}</span> hidden.</>}
      >
        <div className="sm:max-w-sm">
          <SearchField value={hideQuery} onChange={setHideQuery} placeholder="Search staff" />
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5 max-h-[28rem] overflow-y-auto overscroll-contain pr-0.5">
          {filteredHide.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-3"><EmptyLine icon={Users}>No staff match your search.</EmptyLine></div>
          ) : filteredHide.map(s => (
            <div key={s.id} className={AX.row}>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium text-[#18181B] truncate">{s.full_name}</p>
                <p className="text-[11.5px] text-[#71717A] truncate"><span className="capitalize">{s.role}</span> · {s.email}</p>
              </div>
              {s.attendance_hidden && <span className="text-[11px] font-semibold text-[#B8983C] flex-shrink-0">Hidden</span>}
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
    <div className="flex items-center gap-3">
      <p className="flex-1 min-w-0 text-[13px] font-semibold text-[#18181B] leading-tight">{label}</p>
      <input
        type="time" value={value ?? ''} onChange={e => onChange(e.target.value || null)}
        aria-label={label}
        className={`${AX.field} !w-[8.5rem] flex-shrink-0 tabular-nums`}
      />
      {value ? (
        <button onClick={() => onChange(null)} aria-label={`Clear ${label}`} className={AX.icon}>
          <X size={14} />
        </button>
      ) : <span className="w-8 flex-shrink-0" aria-hidden />}
    </div>
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
      className="h-full"
      description={description}
    >
      {groups.length === 0 ? (
        <EmptyLine icon={emptyIcon} fill>{emptyText}</EmptyLine>
      ) : (
        <ul className="flex-1 space-y-1.5 max-h-80 overflow-y-auto overscroll-contain pr-0.5">
          {groups.map(g => {
            const clearing = clearingKey === `${kind}:${g.key}`
            return (
              <li key={g.key} className={`${AX.row} !items-start`}>
                <span className="mt-0.5 text-[#B8983C] flex-shrink-0">
                  {g.scope.type === 'weekday' ? <Repeat size={14} /> : <DateIcon size={14} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-[#18181B]">{g.label}</p>
                  <p className="text-[12px] text-[#71717A] leading-snug break-words">{g.detail}</p>
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
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-semibold text-[#27272A] hover:bg-[#F5F5F5] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
      >
        <Plus size={14} /> {addLabel}
      </button>
    </Panel>
  )
}
