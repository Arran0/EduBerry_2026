'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The parts every WhatsApp reminder popup is built from.
//
// The same shape as the fee app's Reminders popup — figures across the top,
// the list with a search, a class filter, "Select these" and one Remind
// button, a log and an automatic schedule a button away, and a plain account
// of what was sent and what was skipped and why. What differs is the skin:
// rounded throughout, and every colour taken from the page the popup opens
// over (--page-primary, --page-gradient-from/to, …). Those variables are what
// a school repaints in App Settings, so the popups follow without a line of
// code changing.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarClock, Check, CheckCheck, ChevronDown, Clock, Copy, History,
  ListChecks, Loader2, MessageSquareText, PhoneOff, Plus, Search, Send, X,
} from 'lucide-react'
import {
  alreadyReminded, clock, fetchReminderLog, fetchReminderStatus, renderTemplate, saveSchedule,
  saveTemplate, SAMPLE_VARS, SKIP_REASONS, toMetaBody,
  type ReminderKind, type ReminderLogRow, type ReminderSchedule, type ReminderState,
  type ReminderStatus, type SendResult, type WaTemplate,
} from '@/lib/whatsappReminders'

// ── Tokens ────────────────────────────────────────────────────────────────
export const RK = {
  primary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-semibold text-white whitespace-nowrap ' +
    'bg-gradient-to-br from-[color:var(--page-gradient-from,#7c3aed)] to-[color:var(--page-gradient-to,#6d28d9)] ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,.2),0_8px_18px_-10px_rgba(15,23,42,.55)] transition active:scale-[0.97] ' +
    'disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--page-primary,#7c3aed)]/40',
  ghost:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap ' +
    'text-slate-700 bg-white border border-slate-200 hover:text-[color:var(--page-primary-dark,#6d28d9)] ' +
    'hover:border-[color:var(--page-primary,#7c3aed)] transition active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none',
  small:
    'inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap ' +
    'text-[color:var(--page-primary-dark,#6d28d9)] bg-[color:var(--page-primary-light,#ede9fe)] ' +
    'hover:brightness-95 transition active:scale-95 disabled:opacity-40 disabled:pointer-events-none',
  input:
    'w-full h-9 pl-8 pr-3 rounded-full bg-slate-100 border border-transparent text-sm text-slate-900 placeholder:text-slate-400 ' +
    'focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-2 focus:ring-[color:var(--page-primary-light,#ede9fe)] transition',
  select:
    'h-9 pl-3.5 pr-8 rounded-full bg-white border border-slate-200 text-[13px] font-medium text-slate-700 appearance-none ' +
    'focus:outline-none focus:ring-2 focus:ring-[color:var(--page-primary-light,#ede9fe)] transition',
  card: 'rounded-2xl border border-slate-200/80 bg-white overflow-hidden',
  label: 'text-[11px] font-bold uppercase tracking-wider text-slate-500',
  check: 'w-[17px] h-[17px] rounded-md accent-[color:var(--page-primary,#7c3aed)] cursor-pointer disabled:cursor-not-allowed',
}

// ── Popup views ───────────────────────────────────────────────────────────
export type ReminderView = 'list' | 'log' | 'auto' | 'message'

const VIEW_META: Record<ReminderView, { label: string; icon: React.ElementType }> = {
  list:    { label: 'Remind',    icon: Send },
  log:     { label: 'Log',       icon: History },
  auto:    { label: 'Automatic', icon: CalendarClock },
  message: { label: 'Message',   icon: MessageSquareText },
}

export function ViewTabs({ value, onChange, views }: {
  value: ReminderView; onChange: (v: ReminderView) => void; views: ReminderView[]
}) {
  return (
    <div role="tablist" className="flex gap-1 p-1 rounded-full bg-slate-100/90">
      {views.map(v => {
        const { label, icon: Icon } = VIEW_META[v]
        const on = v === value
        return (
          <button key={v} role="tab" aria-selected={on} onClick={() => onChange(v)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold transition ${
              on ? 'bg-white text-[color:var(--page-primary-dark,#6d28d9)] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon size={14} /> <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Figures ───────────────────────────────────────────────────────────────
export function StatRow({ stats, loading }: {
  stats: { label: string; value: number | string; strong?: boolean }[]; loading?: boolean
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {stats.map(s => (
        <div key={s.label}
          className={`rounded-2xl px-3.5 py-2.5 ${s.strong
            ? 'text-white bg-gradient-to-br from-[color:var(--page-gradient-from,#7c3aed)] to-[color:var(--page-gradient-to,#6d28d9)]'
            : 'bg-[color:var(--page-primary-light,#ede9fe)] text-slate-900'}`}>
          <div className="font-display text-[1.45rem] font-bold leading-none tabular-nums">{loading ? '—' : s.value}</div>
          <div className={`text-[11px] font-semibold mt-1 ${s.strong ? 'text-white/85' : 'text-slate-600'}`}>{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Is WhatsApp actually able to send? ────────────────────────────────────
export function useReminderStatus() {
  const [status, setStatus] = useState<ReminderStatus | null>(null)
  useEffect(() => {
    let live = true
    fetchReminderStatus().then(s => { if (live) setStatus(s) }).catch(() => { if (live) setStatus(null) })
    return () => { live = false }
  }, [])
  return status
}

export function Readiness({ status }: { status: ReminderStatus | null }) {
  if (!status || status.connected) return null
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[12.5px] text-amber-900 leading-relaxed">
      <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-amber-600" />
      <span>
        WhatsApp is not connected yet. Reminders you send now wait in the queue and go out the
        moment an admin saves the WhatsApp details (Fees → Settings → WhatsApp).
      </span>
    </div>
  )
}

// ── Toolbar bits ──────────────────────────────────────────────────────────
export function SearchBox({ value, onChange, placeholder = 'Find a student' }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div className="relative flex-1 min-w-[160px]">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        aria-label={placeholder} className={`${RK.input} [&::-webkit-search-cancel-button]:hidden`} />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-300/80 text-white flex items-center justify-center hover:bg-slate-400">
          <X size={11} strokeWidth={3} />
        </button>
      )}
    </div>
  )
}

export function Picker({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string
}) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={label} className={RK.select}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  )
}

// ── One student's state ───────────────────────────────────────────────────
const CHIP = 'inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap'

export function DeliveryChip({ row }: { row: ReminderState }) {
  if (!row.contactable && !alreadyReminded(row)) {
    return <span className={`${CHIP} bg-slate-100 text-slate-500`} title="No number on file, or the family replied STOP">
      <PhoneOff size={11} /> No number
    </span>
  }
  const at = row.reminded_at ? new Date(row.reminded_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''
  switch (row.delivery) {
    case 'queued':
    case 'sending':
      return <span className={`${CHIP} bg-amber-50 text-amber-700`}><Clock size={11} /> Queued {at}</span>
    case 'sent':
      return <span className={`${CHIP} bg-[color:var(--page-primary-light,#ede9fe)] text-[color:var(--page-primary-dark,#6d28d9)]`}><Check size={11} /> Sent {at}</span>
    case 'delivered':
      return <span className={`${CHIP} bg-emerald-50 text-emerald-700`}><CheckCheck size={11} /> Delivered {at}</span>
    case 'failed':
      return <span className={`${CHIP} bg-rose-50 text-rose-700`} title={row.last_error ?? undefined}>Failed · send again</span>
    case 'skipped':
      return <span className={`${CHIP} bg-slate-100 text-slate-600`} title={row.last_error ?? undefined}>Not sent · {row.last_error ?? 'skipped'}</span>
    default:
      return <span className={`${CHIP} text-slate-400`}>Not reminded</span>
  }
}

/** One row of a pick list: tick, who, where, state, and a one-tap Remind. */
export function PickRow({ checked, disabled, onToggle, title, subtitle, state, onRemind, busy }: {
  checked: boolean
  disabled: boolean
  onToggle: (on: boolean) => void
  title: string
  subtitle: React.ReactNode
  state: ReminderState
  onRemind?: () => void
  busy?: boolean
}) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5 border-b border-slate-100 last:border-0">
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onToggle(e.target.checked)} aria-label={`Select ${title}`} className={RK.check} />
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold text-slate-900 break-words">{title}</div>
        <div className="text-[12px] text-slate-500 break-words mt-0.5">{subtitle}</div>
      </div>
      <div className="hidden sm:block flex-shrink-0"><DeliveryChip row={state} /></div>
      {onRemind && (
        <button onClick={onRemind} disabled={disabled || busy} className={RK.small}
          title={disabled ? (state.contactable ? 'Already reminded' : 'No number on file') : 'Remind this family now'}>
          <Send size={11} /> Remind
        </button>
      )}
    </li>
  )
}

export function ListShell({ children, empty }: { children: React.ReactNode; empty?: React.ReactNode }) {
  const items = React.Children.toArray(children)
  return (
    <div className={RK.card}>
      {items.length === 0
        ? <p className="px-4 py-10 text-center text-[13px] text-slate-500">{empty}</p>
        : <ul>{items}</ul>}
    </div>
  )
}

export function LoadingBlock() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2, 3].map(i => <div key={i} className="h-14 rounded-2xl bg-slate-100/90 animate-pulse" />)}
    </div>
  )
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-[12.5px] text-rose-700">{children}</div>
}

/** What a send achieved, in words — never a bare "done". */
export function ResultCard({ result, onClose }: { result: SendResult; onClose: () => void }) {
  const skipped = Object.entries(result.skipped ?? {}).filter(([, n]) => n > 0)
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
          <Check size={16} />
        </span>
        <div className="flex-1 min-w-0 text-[13px] text-slate-800">
          <p>
            <strong>{result.queued}</strong> reminder{result.queued === 1 ? '' : 's'} queued
            {result.sent > 0 && <> · <strong>{result.sent}</strong> already handed to WhatsApp</>}
            {' '}out of {result.considered}.
          </p>
          {skipped.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {skipped.map(([reason, n]) => (
                <li key={reason} className="text-[12px] text-slate-600">
                  {n} skipped — {SKIP_REASONS[reason] ?? SKIP_REASONS.unknown}
                </li>
              ))}
            </ul>
          )}
          {result.note && <p className="mt-1.5 text-[12px] text-amber-700">{result.note}</p>}
        </div>
        <button onClick={onClose} aria-label="Dismiss" className="w-7 h-7 rounded-full text-slate-500 hover:bg-white flex items-center justify-center">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

/** Tick everything reachable that has not been told yet, or clear. */
export function selectAllLabel(allPicked: boolean, n: number) {
  return allPicked ? 'Clear' : `Select these ${n}`
}

export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = useCallback((id: string, on: boolean) => setSelected(s => {
    const next = new Set(s)
    if (on) next.add(id); else next.delete(id)
    return next
  }), [])
  const clear = useCallback(() => setSelected(new Set()), [])
  return { selected, setSelected, toggle, clear }
}

// ── The log: the last seven days ──────────────────────────────────────────
function logState(r: ReminderLogRow): { text: string; cls: string } {
  if (r.failed_at) return { text: 'Failed', cls: 'bg-rose-50 text-rose-700' }
  if (r.skipped_at) return { text: 'Not sent', cls: 'bg-slate-100 text-slate-600' }
  if (r.read_at) return { text: 'Read', cls: 'bg-sky-50 text-sky-700' }
  if (r.delivered_at) return { text: 'Delivered', cls: 'bg-emerald-50 text-emerald-700' }
  if (r.sent_at) return { text: 'Sent', cls: 'bg-[color:var(--page-primary-light,#ede9fe)] text-[color:var(--page-primary-dark,#6d28d9)]' }
  return { text: 'Queued', cls: 'bg-amber-50 text-amber-700' }
}

export function LogView({ kind, subjectId, describe }: {
  kind: ReminderKind
  subjectId?: string | null
  /** Extra context per row, e.g. the route. */
  describe?: (r: ReminderLogRow) => string | null
}) {
  const [rows, setRows] = useState<ReminderLogRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchReminderLog(kind, subjectId)
      .then(r => { if (live) setRows(r) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load the log.') })
    return () => { live = false }
  }, [kind, subjectId])

  const byDay = useMemo(() => {
    const m = new Map<string, ReminderLogRow[]>()
    for (const r of rows ?? []) {
      const day = r.created_at.slice(0, 10)
      m.set(day, [...(m.get(day) ?? []), r])
    }
    return [...m.entries()]
  }, [rows])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!rows) return <LoadingBlock />

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-500 flex items-center gap-1.5">
        <History size={13} /> The last seven days. Older entries are cleared automatically.
      </p>
      {byDay.length === 0 ? (
        <div className={`${RK.card} px-4 py-10 text-center text-[13px] text-slate-500`}>Nothing sent in the last seven days.</div>
      ) : byDay.map(([day, list]) => (
        <div key={day}>
          <div className={`${RK.label} px-1 mb-1.5`}>
            {new Date(day + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            <span className="ml-1.5 font-semibold normal-case tracking-normal text-slate-400">· {list.length}</span>
          </div>
          <ul className={RK.card}>
            {list.map(r => {
              const st = logState(r)
              const extra = describe?.(r)
              return (
                <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-slate-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 break-words">{r.full_name}</div>
                    <div className="text-[11.5px] text-slate-500 break-words mt-0.5">
                      {new Date(r.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                      {r.masked ? ` · ${r.masked}` : ''}
                      {extra ? ` · ${extra}` : ''}
                      {' · '}{r.trigger === 'scheduled' ? 'Automatic' : r.sent_by_name ? `by ${r.sent_by_name}` : 'By hand'}
                      {r.error ? ` · ${r.error}` : ''}
                    </div>
                  </div>
                  <span className={`${CHIP} ${st.cls}`}>{st.text}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

// ── Automatic sending ─────────────────────────────────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ScheduleEditor({ schedule, title, detail, canEdit, onSaved }: {
  schedule: ReminderSchedule
  title: string
  detail: React.ReactNode
  canEdit: boolean
  onSaved: (s: ReminderSchedule) => void
}) {
  const [draft, setDraft] = useState(schedule)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setDraft(schedule) }, [schedule])

  const dirty = draft.enabled !== schedule.enabled
    || draft.send_at.slice(0, 5) !== schedule.send_at.slice(0, 5)
    || draft.days.join() !== schedule.days.join()

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const next = await saveSchedule(draft)
      onSaved(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${RK.card} p-4`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-bold text-slate-900">{title}</h3>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{detail}</p>
        </div>
        <button role="switch" aria-checked={draft.enabled} disabled={!canEdit}
          onClick={() => setDraft(d => ({ ...d, enabled: !d.enabled }))}
          className={`relative inline-flex h-7 w-12 flex-shrink-0 rounded-full transition disabled:opacity-50 ${
            draft.enabled ? 'bg-gradient-to-br from-[color:var(--page-gradient-from,#7c3aed)] to-[color:var(--page-gradient-to,#6d28d9)]' : 'bg-slate-300'}`}>
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${draft.enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-600">
          <Clock size={14} className="text-slate-400" /> Send at
          <input type="time" value={draft.send_at.slice(0, 5)} disabled={!canEdit}
            onChange={e => setDraft(d => ({ ...d, send_at: e.target.value }))}
            className="h-9 px-3 rounded-full bg-slate-100 border border-transparent text-sm font-semibold text-slate-900 focus:outline-none focus:bg-white focus:border-slate-300 disabled:opacity-60" />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
          {DAYS.map((d, i) => {
            const on = draft.days.includes(i)
            return (
              <button key={d} disabled={!canEdit} aria-pressed={on}
                onClick={() => setDraft(x => ({ ...x, days: on ? x.days.filter(v => v !== i) : [...x.days, i].sort() }))}
                className={`h-8 min-w-[2.6rem] px-2 rounded-full text-[11.5px] font-semibold transition disabled:opacity-60 ${
                  on ? 'text-white bg-gradient-to-br from-[color:var(--page-gradient-from,#7c3aed)] to-[color:var(--page-gradient-to,#6d28d9)]'
                     : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}>
                {d}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        {canEdit ? (
          <button onClick={() => void save()} disabled={busy || !dirty} className={RK.primary}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
        ) : (
          <span className="text-[12px] text-slate-400">Only an admin can change this.</span>
        )}
        {saved && <span className="text-[12px] font-semibold text-emerald-600">Saved</span>}
        <span className="text-[12px] text-slate-500">
          {schedule.enabled
            ? `On — every ${schedule.days.map(d => DAYS[d]).join(', ') || 'no day'} at ${clock(schedule.send_at)}`
            : 'Off — reminders only go when somebody presses Remind'}
          {schedule.enabled && schedule.last_run_on ? ` · last ran ${new Date(schedule.last_run_on + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
        </span>
      </div>
      {error && <div className="mt-2.5"><ErrorNote>{error}</ErrorNote></div>}
    </div>
  )
}

// ── The message itself ────────────────────────────────────────────────────
/**
 * The wording a family receives, and the one thing a school must type into
 * WhatsApp Manager to make it send: the approved template's name. The body is
 * shown in Meta's {{1}} form, ready to paste, with sample values for review.
 */
export function TemplateEditor({ template, canEdit, onSaved, allowBodyEdit = false }: {
  template: WaTemplate
  canEdit: boolean
  onSaved: () => void
  allowBodyEdit?: boolean
}) {
  const [name, setName] = useState(template.provider_template_name ?? '')
  const [lang, setLang] = useState(template.provider_template_lang ?? 'en')
  const [active, setActive] = useState(template.active)
  const [title, setTitle] = useState(template.title_template ?? '')
  const [body, setBody] = useState(template.body_template ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const metaBody = toMetaBody(body, template.variable_order)
  const preview = renderTemplate(body, SAMPLE_VARS)

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await saveTemplate({ key: template.key, name: name.trim(), lang: lang.trim() || 'en', active, title, body: allowBodyEdit ? body : null })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${RK.card} p-4 space-y-3.5`}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[14px] font-bold text-slate-900">{template.title_template || template.key}</h3>
        <span className={`${CHIP} ${template.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {template.active ? 'In use' : 'Switched off'}
        </span>
      </div>

      <div className="rounded-2xl bg-[color:var(--page-primary-light,#ede9fe)] p-3.5">
        <div className={`${RK.label} mb-1.5`}>What a parent reads</div>
        <p className="text-[13px] text-slate-800 leading-relaxed">{preview}</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className={RK.label}>Body to register in WhatsApp Manager</span>
          <button onClick={() => { void navigator.clipboard?.writeText(metaBody); setCopied(true); setTimeout(() => setCopied(false), 1600) }}
            className={RK.small}>
            {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {allowBodyEdit && canEdit ? (
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={3}
            className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-[12.5px] font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-[color:var(--page-primary-light,#ede9fe)]" />
        ) : (
          <p className="rounded-2xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-[12.5px] font-mono text-slate-700 leading-relaxed break-words">{metaBody}</p>
        )}
        <p className="text-[11.5px] text-slate-500 mt-1.5 leading-relaxed">
          Category <strong>Utility</strong>. Sample values, in order:{' '}
          {(template.variable_order ?? []).map((k, i) => `{{${i + 1}}} ${SAMPLE_VARS[k] ?? k}`).join(' · ')}
        </p>
      </div>

      {canEdit ? (
        <div className="grid sm:grid-cols-[1fr_7rem] gap-3">
          {allowBodyEdit && (
            <label className="sm:col-span-2 block">
              <span className={RK.label}>Name shown to staff</span>
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="mt-1 w-full h-9 px-3.5 rounded-full bg-slate-100 border border-transparent text-sm focus:outline-none focus:bg-white focus:border-slate-300" />
            </label>
          )}
          <label className="block">
            <span className={RK.label}>Approved template name</span>
            <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="e.g. attendance_absent_not_arrived"
              className="mt-1 w-full h-9 px-3.5 rounded-full bg-slate-100 border border-transparent text-sm font-mono focus:outline-none focus:bg-white focus:border-slate-300" />
          </label>
          <label className="block">
            <span className={RK.label}>Language</span>
            <input value={lang} onChange={e => setLang(e.target.value)}
              className="mt-1 w-full h-9 px-3.5 rounded-full bg-slate-100 border border-transparent text-sm font-mono focus:outline-none focus:bg-white focus:border-slate-300" />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className={RK.check} />
              Use this template
            </label>
            <div className="flex-1" />
            <button onClick={() => void save()} disabled={busy || !name.trim()} className={RK.primary}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-slate-500">
          Sent as WhatsApp template <code className="font-mono text-slate-700">{template.provider_template_name || '—'}</code>.
          Only an admin can change it.
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  )
}

/** An admin adds another announcement type — its own approved template. */
export function NewAnnouncementTemplate({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={RK.ghost}>
        <Plus size={14} /> Add another announcement template
      </button>
    )
  }

  const slug = name.replace(/^announcement_/, '') || 'custom'
  const create = async () => {
    setBusy(true); setError(null)
    try {
      await saveTemplate({ key: `announcement.${slug}`, name, active: true, title: label || 'Announcement reminder' })
      setOpen(false); setLabel(''); setName('')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${RK.card} p-4 space-y-3`}>
      <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2"><ListChecks size={15} /> New announcement template</h3>
      <p className="text-[12px] text-slate-500 leading-relaxed">
        For a kind of announcement worded differently — an exam notice, a holiday. It takes the same
        four values in the same order; register it in WhatsApp Manager, then type the name it was approved under.
      </p>
      <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Shown to staff, e.g. Holiday notice"
        className="w-full h-9 px-3.5 rounded-full bg-slate-100 border border-transparent text-sm focus:outline-none focus:bg-white focus:border-slate-300" />
      <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
        placeholder="Approved template name, e.g. holiday_notice"
        className="w-full h-9 px-3.5 rounded-full bg-slate-100 border border-transparent text-sm font-mono focus:outline-none focus:bg-white focus:border-slate-300" />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className={RK.ghost}>Cancel</button>
        <button onClick={() => void create()} disabled={busy || !name} className={RK.primary}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </div>
    </div>
  )
}
