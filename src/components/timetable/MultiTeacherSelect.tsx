'use client'

import React, { useMemo } from 'react'
import { X, Star } from 'lucide-react'
import { SmartSelect } from './ui'
import type { SmartOption } from './ui'
import type { UserProfile } from '@/lib/supabase'

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

  const options: SmartOption[] = useMemo(
    () =>
      teachers
        .filter((t) => !value.includes(t.id))
        .map((t) => ({ value: t.id, label: t.full_name, sublabel: t.email })),
    [teachers, value],
  )

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
          {value.map((id, i) => (
            <span
              key={id}
              className={`inline-flex items-center gap-1 pl-2 pr-1 py-1 text-xs border ${
                i === 0
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
              <button
                type="button"
                onClick={() => remove(id)}
                title="Remove"
                className={i === 0 ? 'text-white/60 hover:text-white' : 'text-[#A1A1AA] hover:text-rose-500'}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
