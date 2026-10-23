'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Announcement reminders — one announcement, its student audience.
//
// The audience is worked out the way the feed works it out (all students, a
// grade, a grade-section, named students), in the database. Each student can
// be reminded about a given announcement once; pressing Remind again, from
// this screen or anyone else's, does nothing for those already told.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Loader2, Send } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { useAuth } from '@/contexts/AuthContext'
import { gradeShortLabel } from '@/lib/grades'
import {
  alreadyReminded, canPick, fetchAnnouncementRecipients, fetchTemplates, sendReminders,
  type AnnouncementRecipientRow, type SendResult, type WaTemplate,
} from '@/lib/whatsappReminders'
import {
  ErrorNote, ListShell, LoadingBlock, LogView, NewAnnouncementTemplate, PickRow, Picker, RK,
  Readiness, ResultCard, SearchBox, StatRow, TemplateEditor, ViewTabs, selectAllLabel,
  useReminderStatus, useSelection, type ReminderView,
} from './ReminderKit'

const classOf = (r: { grade: number | null; section: string | null }) =>
  r.grade == null ? 'No class' : `${gradeShortLabel(r.grade)}${r.section ? `-${r.section}` : ''}`

export default function AnnouncementRemindersModal({ announcement, onClose }: {
  announcement: { id: string; title: string }
  onClose: () => void
}) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const status = useReminderStatus()

  const [view, setView] = useState<ReminderView>('list')
  const [rows, setRows] = useState<AnnouncementRecipientRow[] | null>(null)
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [templateKey, setTemplateKey] = useState('announcement.reminder')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [klass, setKlass] = useState('')
  const { selected, setSelected, toggle, clear } = useSelection()
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await fetchAnnouncementRecipients(announcement.id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the audience.') }
  }, [announcement.id])

  const loadTemplates = useCallback(async () => {
    try { setTemplates(await fetchTemplates('announcement.')) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the templates.') }
  }, [])

  useEffect(() => { void load(); void loadTemplates() }, [load, loadTemplates])

  const usable = templates.filter(t => t.active && t.provider_template_name)

  const classes = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows ?? []) s.add(classOf(r))
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(r =>
      (!klass || classOf(r) === klass) && (!q || r.full_name.toLowerCase().includes(q)))
  }, [rows, klass, query])

  const pickable = shown.filter(canPick)
  const allPicked = pickable.length > 0 && pickable.every(r => selected.has(r.student_id))

  const totals = useMemo(() => {
    const all = rows ?? []
    return {
      audience: all.length,
      reminded: all.filter(alreadyReminded).length,
      waiting: all.filter(canPick).length,
      noNumber: all.filter(r => !r.contactable).length,
    }
  }, [rows])

  const remind = async (ids: string[]) => {
    if (ids.length === 0) return
    setSending(true); setError(null)
    try {
      setResult(await sendReminders({
        kind: 'announcement', announcement_id: announcement.id, student_ids: ids, template: templateKey,
      }))
      clear()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those reminders were not sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      minHClass="sm:min-h-[38rem]"
      title="Announcement reminders"
      subtitle={announcement.title}
      icon={<BellRing size={17} />}
      iconClassName="text-white bg-gradient-to-br from-[color:var(--page-gradient-from,#8b5cf6)] to-[color:var(--page-gradient-to,#6366f1)]"
      bodyClassName="space-y-3"
    >
      <ViewTabs value={view} onChange={setView} views={['list', 'log', 'message']} />
      <Readiness status={status} />
      {error && <ErrorNote>{error}</ErrorNote>}

      {view === 'list' && (
        <>
          <StatRow loading={!rows} stats={[
            { label: 'Students in audience', value: totals.audience, strong: true },
            { label: 'Not reminded yet', value: totals.waiting },
            { label: 'Already reminded', value: totals.reminded },
            { label: 'No number', value: totals.noNumber },
          ]} />

          {result && <ResultCard result={result} onClose={() => setResult(null)} />}

          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} />
            {classes.length > 1 && (
              <Picker label="Class" value={klass} onChange={v => { setKlass(v); clear() }}
                options={[{ value: '', label: 'Every class' }, ...classes.map(c => ({ value: c, label: c }))]} />
            )}
            {usable.length > 1 && (
              <Picker label="Template" value={templateKey} onChange={setTemplateKey}
                options={usable.map(t => ({ value: t.key, label: t.title_template || t.key }))} />
            )}
            <button onClick={() => setSelected(allPicked ? new Set() : new Set(pickable.map(r => r.student_id)))}
              disabled={pickable.length === 0} className={RK.ghost}>
              {selectAllLabel(allPicked, pickable.length)}
            </button>
            <button onClick={() => void remind([...selected])} disabled={sending || selected.size === 0} className={RK.primary}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Remind {selected.size || ''}
            </button>
          </div>

          {!rows ? <LoadingBlock /> : (
            <ListShell empty={rows.length === 0
              ? 'This announcement has no student audience — it went to staff only.'
              : 'Nobody matches that.'}>
              {shown.map(r => (
                <PickRow
                  key={r.student_id}
                  title={r.full_name}
                  subtitle={<>{classOf(r)}{r.masked ? ` · ${r.masked}` : ''}</>}
                  state={r}
                  checked={selected.has(r.student_id)}
                  disabled={!canPick(r)}
                  onToggle={on => toggle(r.student_id, on)}
                  onRemind={() => void remind([r.student_id])}
                  busy={sending}
                />
              ))}
            </ListShell>
          )}

          <p className="text-[11.5px] text-slate-500 leading-relaxed px-1">
            Each student is reminded about this announcement once. Siblings who share a number each
            get their own message.
          </p>
        </>
      )}

      {view === 'log' && <LogView kind="announcement" subjectId={announcement.id} />}

      {view === 'message' && (
        templates.length === 0 ? <LoadingBlock /> : (
          <div className="space-y-3">
            {templates.map(t => (
              <TemplateEditor key={t.key} template={t} canEdit={isAdmin} allowBodyEdit={t.key !== 'announcement.reminder'}
                onSaved={() => void loadTemplates()} />
            ))}
            {isAdmin && <NewAnnouncementTemplate onSaved={() => void loadTemplates()} />}
          </div>
        )
      )}
    </ModalShell>
  )
}
