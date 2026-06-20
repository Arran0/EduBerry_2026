'use client'

import React from 'react'
import { CreateExamInput, Exam } from '@/lib/exam'
import { ExamMode, listExamModes, getExamMode } from '@/lib/examScoring'

// Local form state — strings for inputs, converted on save.
export interface SettingsState {
  title: string
  description: string
  subject: string
  grade: string
  duration_minutes: string
  start_at: string
  due_at: string
  exam_mode: ExamMode
}

export function emptySettings(): SettingsState {
  return {
    title: '', description: '', subject: '', grade: '',
    duration_minutes: '', start_at: '', due_at: '',
    exam_mode: 'school',
  }
}

// datetime-local needs "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function settingsFromExam(exam: Exam): SettingsState {
  return {
    title: exam.title,
    description: exam.description ?? '',
    subject: exam.subject ?? '',
    grade: exam.grade != null ? String(exam.grade) : '',
    duration_minutes: exam.duration_minutes != null ? String(exam.duration_minutes) : '',
    start_at: toLocalInput(exam.start_at),
    due_at: toLocalInput(exam.due_at),
    exam_mode: exam.exam_mode ?? 'school',
  }
}

export function settingsToInput(s: SettingsState): CreateExamInput {
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const ts = (v: string) => (v.trim() === '' ? null : new Date(v).toISOString())
  return {
    title: s.title.trim(),
    description: s.description.trim() || null,
    subject: s.subject.trim() || null,
    grade: num(s.grade),
    duration_minutes: num(s.duration_minutes),
    start_at: ts(s.start_at),
    due_at: ts(s.due_at),
    exam_mode: s.exam_mode,
  }
}

const field = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200'
const label = 'block text-xs font-medium text-slate-500 mb-1'

export function ExamSettingsForm({
  value,
  onChange,
}: {
  value: SettingsState
  onChange: (next: SettingsState) => void
}) {
  const set = (patch: Partial<SettingsState>) => onChange({ ...value, ...patch })
  const mode = getExamMode(value.exam_mode)

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <label className={label}>Title *</label>
        <input className={field} value={value.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Physics Unit Test 1" />
      </div>

      <div>
        <label className={label}>Description</label>
        <textarea className={field} rows={2} value={value.description} onChange={e => set({ description: e.target.value })} placeholder="Optional instructions" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Subject</label>
          <input className={field} value={value.subject} onChange={e => set({ subject: e.target.value })} placeholder="Physics" />
        </div>
        <div>
          <label className={label}>Grade</label>
          <input className={field} type="number" value={value.grade} onChange={e => set({ grade: e.target.value })} placeholder="11" />
        </div>
      </div>

      <div>
        <label className={label}>Duration (minutes)</label>
        <input className={field} type="number" value={value.duration_minutes} onChange={e => set({ duration_minutes: e.target.value })} placeholder="60" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Opens at</label>
          <input className={field} type="datetime-local" value={value.start_at} onChange={e => set({ start_at: e.target.value })} />
        </div>
        <div>
          <label className={label}>Due at</label>
          <input className={field} type="datetime-local" value={value.due_at} onChange={e => set({ due_at: e.target.value })} />
          <p className="mt-1 text-[11px] text-slate-400">Date &amp; time this exam is due.</p>
        </div>
      </div>

      {/* Exam Mode */}
      <div>
        <label className={label}>Exam mode</label>
        <select
          className={field}
          value={value.exam_mode}
          onChange={e => set({ exam_mode: e.target.value as ExamMode })}
        >
          {listExamModes().map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">{mode.description}</p>
      </div>
    </div>
  )
}
