'use client'

import React, { useMemo } from 'react'
import { X, Star, AlertTriangle } from 'lucide-react'
import { SmartSelect } from './ui'
import type { SmartOption } from './ui'
import type { UserProfile } from '@/lib/supabase'
import { useTimetableDraftOptional } from './draft/TimetableDraftContext'
import { loadTone } from './draft/TeacherLoad'

/**
 * Picks one or more teachers for a lesson (Round 8 co-teaching). The first
 * chip is the primary teacher — the one written to the legacy `teacher_id`
 * column and shown when a cell only has room for one name — and can be
 * re-chosen by clicking another chip's star.
 */
export default function MultiTeacherSelect({
  teachers,
  value,
  onChange,
  placeholder = 'Add a teacher…',
  emptyLabel = 'Unassigned',
  compact = false,
}: {
  teachers: UserProfile[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  emptyLabel?: string
  compact?: boolean
}) {
  const byId = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  // How full each teacher's week already is, so the picker shows who has room
  // before one more lesson is handed to someone who hasn't.
  const draft = useTimetableDraftOptional()

  const options: SmartOption[] = useMemo(
    () =>
      teachers
        .filter((t) => !value.includes(t.id))
        .map((t) => {
          const w = draft?.workloadOf(t.id)
          return {
            value: t.id,
            label: t.full_name,
            sublabel: w
              ? `${w.assigned}/${w.capacity} periods${w.over > 0 ? ` · ${w.over} over` : ''}`
              : t.email,
            badge: w && w.over > 0 ? 'Over' : undefined,
          }
        }),
    [teachers, value, draft],
  )

  // Anyone picked here who already cannot fit their week.
  const picked = value.map((id) => draft?.workloadOf(id)).filter((w) => w && w.over > 0)

  const add = (id: string) => {
    if (!id || value.includes(id)) return
    onChange([...value, id])
  }
  const remove = (id: string) => onChange(value.filter((v) => v !== id))
  const makePrimary = (id: string) => onChange([id, ...value.filter((v) => v !== id)])

  return (
    <div>
      <SmartSelect
        options={options}
        value=""
        onChange={add}
        placeholder={placeholder}
        searchPlaceholder="Search staff…"
        emptyText="No more staff"
      />
      {value.length === 0 ? (
        <p className={`text-[12px] text-slate-400 ${compact ? 'mt-1' : 'mt-1.5'}`}>{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {value.map((id, i) => {
            const w = draft?.workloadOf(id)
            const tone = loadTone(w)
            return (
            <span
              key={id}
              title={
                w
                  ? w.over > 0
                    ? `${w.assigned} periods given, room for ${w.capacity}. ${w.over} cannot be placed.`
                    : `${w.assigned} of ${w.capacity} periods assigned`
                  : undefined
              }
              className={`inline-flex items-center gap-1 min-h-[30px] max-w-full pl-2.5 pr-1 py-0.5 rounded-full text-[12.5px] ${
                tone === 'over'
                  ? 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200'
                  : i === 0
                    ? 'bg-gradient-to-b from-[#3D3B40] to-[#27272A] text-white'
                    : 'bg-[#F1EEE7] text-slate-800'
              }`}
            >
              {i === 0 ? (
                <Star size={11} className="flex-shrink-0 fill-current" />
              ) : (
                <button
                  type="button"
                  onClick={() => makePrimary(id)}
                  title="Make main teacher"
                  aria-label="Make main teacher"
                  className="text-slate-400 hover:text-[#B8983C] flex-shrink-0"
                >
                  <Star size={11} />
                </button>
              )}
              <span className="min-w-0 break-words leading-tight">{byId.get(id)?.full_name ?? 'Teacher'}</span>
              {w && w.assigned > 0 && (
                <span
                  className={`tabular-nums text-[10px] ${
                    tone === 'over'
                      ? 'text-rose-600 font-semibold'
                      : tone === 'tight'
                        ? 'text-amber-600'
                        : i === 0 ? 'text-white/60' : 'text-slate-400'
                  }`}
                >
                  {w.assigned}/{w.capacity}
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(id)}
                title="Remove"
                aria-label={`Remove ${byId.get(id)?.full_name ?? 'teacher'}`}
                className={`w-6 h-6 rounded-full inline-flex items-center justify-center flex-shrink-0 ${
                  tone === 'over'
                    ? 'text-rose-400 hover:text-rose-600 hover:bg-white'
                    : i === 0 ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-rose-500 hover:bg-white'
                }`}
              >
                <X size={12} />
              </button>
            </span>
            )
          })}
        </div>
      )}
      {picked.length > 0 && (
        <p className="flex items-start gap-1.5 text-[12px] text-rose-700 mt-1.5 leading-snug">
          <AlertTriangle size={12} className="flex-shrink-0 mt-px" />
          <span>
            {picked.length === 1
              ? `${byId.get(picked[0]!.teacherId)?.full_name ?? 'This teacher'} is already over their week by ${picked[0]!.over} period${picked[0]!.over === 1 ? '' : 's'}.`
              : `${picked.length} of these teachers are already over their week.`}{' '}
            More periods for them cannot be placed.
          </span>
        </p>
      )}
    </div>
  )
}
