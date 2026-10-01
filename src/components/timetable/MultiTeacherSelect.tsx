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
        <p className={`text-[11px] text-[#A1A1AA] ${compact ? 'mt-1' : 'mt-1.5'}`}>{emptyLabel}</p>
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
                    ? `${w.assigned} periods assigned, only ${w.capacity} available — ${w.over} cannot be scheduled`
                    : `${w.assigned} of ${w.capacity} periods assigned`
                  : undefined
              }
              className={`inline-flex items-center gap-1 pl-2 pr-1 py-1 text-xs border ${
                tone === 'over'
                  ? 'bg-rose-50 text-rose-800 border-rose-300'
                  : i === 0
                    ? 'bg-[#27272A] text-white border-[#27272A]'
                    : 'bg-[#F5F5F5] text-[#3F3F46] border-[#E4E4E7]'
              }`}
            >
              {i === 0 ? (
                <Star size={11} className="flex-shrink-0 fill-current" />
              ) : (
                <button
                  type="button"
                  onClick={() => makePrimary(id)}
                  title="Make primary teacher"
                  className="text-[#A1A1AA] hover:text-[#B8983C]"
                >
                  <Star size={11} />
                </button>
              )}
              <span className="truncate max-w-[10rem]">{byId.get(id)?.full_name ?? 'Teacher'}</span>
              {w && w.assigned > 0 && (
                <span
                  className={`tabular-nums text-[10px] ${
                    tone === 'over'
                      ? 'text-rose-600 font-semibold'
                      : tone === 'tight'
                        ? 'text-amber-600'
                        : i === 0 ? 'text-white/60' : 'text-[#A1A1AA]'
                  }`}
                >
                  {w.assigned}/{w.capacity}
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(id)}
                title="Remove"
                className={
                  tone === 'over'
                    ? 'text-rose-400 hover:text-rose-600'
                    : i === 0 ? 'text-white/60 hover:text-white' : 'text-[#A1A1AA] hover:text-rose-500'
                }
              >
                <X size={12} />
              </button>
            </span>
            )
          })}
        </div>
      )}
      {picked.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-rose-700 mt-1.5">
          <AlertTriangle size={12} className="flex-shrink-0 mt-px" />
          <span>
            {picked.length === 1
              ? `${byId.get(picked[0]!.teacherId)?.full_name ?? 'This teacher'} is already over their week by ${picked[0]!.over} period${picked[0]!.over === 1 ? '' : 's'}.`
              : `${picked.length} of these teachers are already over their week.`}{' '}
            Adding more here cannot be scheduled.
          </span>
        </p>
      )}
    </div>
  )
}
