'use client'

import React from 'react'
import { CreateExamInput, Exam, GradingMethod } from '@/lib/exam'

// Local form state — strings for inputs, converted on save.
export interface SettingsState {
  title: string
  description: string
  subject: string
  grade: string
  duration_minutes: string
  start_at: string
  end_at: string
  due_at: string
  grading_method: GradingMethod
  negative_ratio: string
}

export function emptySettings(): SettingsState {
  return {
    title: '', description: '', subject: '', grade: '',
    duration_minutes: '', start_at: '', end_at: '', due_at: '',
    grading_method: 'none', negative_ratio: '0.25',
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
    end_at: toLocalInput(exam.end_at),
    due_at: toLocalInput(exam.due_at),
    grading_method: exam.grading_method,
    negative_ratio: String(exam.negative_ratio || 0.25),
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
    end_at: ts(s.end_at),
    due_at: ts(s.due_at),
    grading_method: s.grading_method,
    negative_ratio: s.grading_method === 'custom' ? Number(s.negative_ratio || 0) : null,
  }
}

const field = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200'
const label = 'block text-xs font-medium text-slate-500 mb-1'

const GRADING_OPTIONS: { value: GradingMethod; label: string; hint: string }[] = [
  { value: 'none', label: 'No negative marking', hint: 'Wrong answers score 0' },
  { value: 'neet', label: 'NEET', hint: '+full / −25% / 0 for blank' },
  { value: 'jee', label: 'JEE Main', hint: '+full / −25% / 0 for blank' },
  { value: 'custom', label: 'Custom', hint: 'Set your own penalty ratio' },
]

export function ExamSettingsForm({
  value,
  onChange,
}: {
  value: SettingsState
  onChange: (next: SettingsState) => void
}) {
  const set = (patch: Partial<SettingsState>) => onChange({ ...value, ...patch })

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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Duration (minutes)</label>
          <input className={field} type="number" value={value.duration_minutes} onChange={e => set({ duration_minutes: e.target.value })} placeholder="60" />
        </div>
        <div>
          <label className={label}>Due date/time</label>
          <input className={field} type="datetime-local" value={value.due_at} onChange={e => set({ due_at: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Opens at</label>
          <input className={field} type="datetime-local" value={value.start_at} onChange={e => set({ start_at: e.target.value })} />
        </div>
        <div>
          <label className={label}>Closes at</label>
          <input className={field} type="datetime-local" value={value.end_at} onChange={e => set({ end_at: e.target.value })} />
        </div>
      </div>

      <div>
        <label className={label}>Grading method</label>
        <div className="grid grid-cols-2 gap-2">
          {GRADING_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set({ grading_method: opt.value })}
              className={`text-left px-3 py-2 rounded-xl border text-sm transition-colors ${
                value.grading_method === opt.value
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="font-medium text-slate-700">{opt.label}</div>
              <div className="text-[11px] text-slate-400">{opt.hint}</div>
            </button>
          ))}
        </div>
        {value.grading_method === 'custom' && (
          <div className="mt-3">
            <label className={label}>Penalty ratio (0–1 of question marks)</label>
            <input
              className={field}
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={value.negative_ratio}
              onChange={e => set({ negative_ratio: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  )
}
