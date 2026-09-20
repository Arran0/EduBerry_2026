'use client'

import React from 'react'
import { CreateExamInput, Exam } from '@/lib/exam'
import { ExamMode, listExamModes, getExamMode } from '@/lib/examScoring'
import SubjectPicker from '@/components/exam/SubjectPicker'
import { EXAM, SectionBand } from '@/components/exam/examUi'

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
  immediate_results: boolean
  auto_close_at: string
}

export function emptySettings(): SettingsState {
  return {
    title: '', description: '', subject: '', grade: '',
    duration_minutes: '', start_at: '', due_at: '',
    exam_mode: 'school',
    immediate_results: false, auto_close_at: '',
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
    immediate_results: exam.immediate_results ?? false,
    auto_close_at: toLocalInput(exam.auto_close_at),
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
    immediate_results: s.immediate_results,
    auto_close_at: s.immediate_results ? ts(s.auto_close_at) : null,
  }
}

/**
 * Why the immediate-results toggle can't be switched on, or null when it can.
 * Immediate publishing needs every question to be auto-graded — one manual
 * (short answer / subjective) question means a human still has to grade.
 */
export function immediateResultsBlocker(autoGradable: AutoGradable): string | null {
  if (autoGradable === 'no_questions') return 'Add questions first — this needs a fully auto-graded exam.'
  if (autoGradable === 'has_manual') return 'This exam has short-answer or subjective questions, which need manual grading.'
  return null
}

/** Whether the exam's questions allow immediate results. */
export type AutoGradable = 'yes' | 'has_manual' | 'no_questions'

/** Settings that are incomplete and should block saving, or null when valid. */
export function settingsError(s: SettingsState): string | null {
  if (s.immediate_results && !s.auto_close_at.trim()) {
    return 'Choose when to auto-close the exam — immediate-results exams need a close date.'
  }
  if (s.immediate_results && s.due_at.trim() && s.auto_close_at.trim()
      && new Date(s.auto_close_at) < new Date(s.due_at)) {
    return 'Auto-close must be on or after the due date.'
  }
  return null
}

const field = EXAM.field

/** One labelled control in the settings grid. `span` widens it on desktop. */
function Field({
  label: text,
  hint,
  span = 1,
  children,
}: {
  label: string
  hint?: string
  span?: 1 | 2 | 3
  children: React.ReactNode
}) {
  const spanCls = span === 3 ? 'sm:col-span-3' : span === 2 ? 'sm:col-span-2' : ''
  return (
    <div className={spanCls}>
      <label className={EXAM.fieldLabel}>{text}</label>
      {children}
      {hint && <p className={EXAM.hint}>{hint}</p>}
    </div>
  )
}

export function ExamSettingsForm({
  value,
  onChange,
  autoGradable = 'no_questions',
}: {
  value: SettingsState
  onChange: (next: SettingsState) => void
  /** Whether this exam's questions permit immediate results. */
  autoGradable?: AutoGradable
}) {
  const set = (patch: Partial<SettingsState>) => onChange({ ...value, ...patch })
  const mode = getExamMode(value.exam_mode)
  const blocker = immediateResultsBlocker(autoGradable)
  const error = settingsError(value)

  return (
    <div className={EXAM.card}>
      {/* Identity */}
      <SectionBand label="Paper" hint="What this exam is" />
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
        <Field label="Title *" span={2}>
          <input className={field} value={value.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Physics Unit Test 1" />
        </Field>
        <Field label="Grade">
          <input className={field} type="number" value={value.grade} onChange={e => set({ grade: e.target.value })} placeholder="11" />
        </Field>
        <Field label="Subject" span={2}>
          <SubjectPicker value={value.subject} onChange={v => set({ subject: v })} />
        </Field>
        <Field label="Duration" hint="Minutes from the moment a student starts.">
          <input className={field} type="number" value={value.duration_minutes} onChange={e => set({ duration_minutes: e.target.value })} placeholder="60" />
        </Field>
        <Field label="Instructions" span={3} hint="Shown to students before they begin. Optional.">
          <textarea className={EXAM.textarea} rows={2} value={value.description} onChange={e => set({ description: e.target.value })} placeholder="Optional instructions" />
        </Field>
      </div>

      {/* Scoring */}
      <SectionBand label="Scoring" hint="How answers earn marks" />
      <div className="p-4">
        <Field label="Exam mode" hint={mode.description}>
          <select
            className={field}
            value={value.exam_mode}
            onChange={e => set({ exam_mode: e.target.value as ExamMode })}
          >
            {listExamModes().map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Window */}
      <SectionBand label="Window" hint="When students may attempt" />
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Opens at" hint="Before this, the exam is visible but locked.">
          <input className={field} type="datetime-local" value={value.start_at} onChange={e => set({ start_at: e.target.value })} />
        </Field>
        <Field label="Due at" hint="Last moment an attempt can be handed in.">
          <input className={field} type="datetime-local" value={value.due_at} onChange={e => set({ due_at: e.target.value })} />
        </Field>
      </div>

      {/* Results */}
      <SectionBand label="Results" hint="When scores reach students" />
      <div className="p-4 space-y-3">
        <label
          className={`flex items-start gap-3 border p-3 transition-colors ${
            blocker
              ? 'cursor-not-allowed border-[#E4E1D8] bg-[#FAF9F6]'
              : value.immediate_results
                ? 'cursor-pointer border-[#B8983C] bg-[#F4F2EC]'
                : 'cursor-pointer border-[#E4E1D8] hover:border-[#B8983C]'
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 accent-[#B8983C] disabled:opacity-40"
            checked={value.immediate_results && !blocker}
            disabled={!!blocker}
            onChange={e => set({ immediate_results: e.target.checked })}
          />
          <span className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-[0.08em] text-[#18181B]">Publish results immediately</span>
            <span className="block text-[11px] text-[#8A8578] leading-relaxed mt-1">
              {blocker
                ? blocker
                : 'Each student sees their score and answer review the moment they submit. Available because every question is auto-graded.'}
            </span>
          </span>
        </label>

        {value.immediate_results && !blocker && (
          <div className="sm:max-w-sm">
            <label className={EXAM.fieldLabel}>Auto-close the exam at *</label>
            <input
              className={field}
              type="datetime-local"
              value={value.auto_close_at}
              onChange={e => set({ auto_close_at: e.target.value })}
            />
            <p className={EXAM.hint}>
              At this moment the exam publishes results to everyone, marks no-shows absent and closes.
              Exams without immediate results close when you publish results.
            </p>
          </div>
        )}

        {error && <p className={EXAM.error}>{error}</p>}
      </div>
    </div>
  )
}
