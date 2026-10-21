'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Plus, X, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { gradeLabel } from '@/lib/grades'
import { classLabel, sortClassLabels } from '@/lib/taskClasses'

interface ClassRow { grade: number | null; section: string | null; name: string; label: string }

// The school's classes change once a year, so one fetch serves every picker
// opened while the page is up.
let classesPromise: Promise<ClassRow[]> | null = null
function loadClasses(): Promise<ClassRow[]> {
  if (!classesPromise) {
    const today = new Date().toISOString().slice(0, 10)
    classesPromise = Promise.resolve(
      supabase
        .from('homerooms')
        .select('name, grade, section, expiry_date')
        .or(`expiry_date.is.null,expiry_date.gte.${today}`)
        .order('grade', { ascending: true, nullsFirst: false })
        .order('section', { ascending: true }),
    ).then(({ data }) => {
      const seen = new Set<string>()
      const out: ClassRow[] = []
      for (const h of data ?? []) {
        const label = classLabel(h)
        if (!label || seen.has(label)) continue
        seen.add(label)
        out.push({ grade: h.grade, section: h.section, name: h.name, label })
      }
      return out
    }).catch(() => {
      classesPromise = null
      return []
    })
  }
  return classesPromise
}

/**
 * The grades and sections a task is for. Chosen classes sit in the row as
 * chips; the full list opens underneath, one line per grade.
 */
export default function ClassPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [classes, setClasses] = useState<ClassRow[] | null>(null)

  useEffect(() => {
    if (!open || classes) return
    let cancelled = false
    loadClasses().then(c => { if (!cancelled) setClasses(c) })
    return () => { cancelled = true }
  }, [open, classes])

  const byGrade = useMemo(() => {
    const map = new Map<string, ClassRow[]>()
    for (const c of classes ?? []) {
      const key = c.grade == null ? 'Other' : gradeLabel(c.grade)
      const list = map.get(key)
      if (list) list.push(c)
      else map.set(key, [c])
    }
    return [...map.entries()]
  }, [classes])

  const toggle = (label: string) =>
    onChange(value.includes(label) ? value.filter(v => v !== label) : sortClassLabels([...value, label]))

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map(label => (
          <span key={label} className="inline-flex items-center gap-0.5 h-7 pl-2.5 pr-1 rounded-full bg-amber-50 border border-amber-200 text-[12.5px] font-semibold text-amber-900">
            {label}
            <button type="button" onClick={() => toggle(label)} aria-label={`Remove ${label}`} className="w-5 h-5 inline-flex items-center justify-center rounded-full text-amber-700/70 hover:text-red-600 hover:bg-white">
              <X size={11} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-amber-900/20 text-[12.5px] font-semibold text-amber-800 hover:border-amber-400 hover:bg-amber-50 transition"
        >
          {open ? <ChevronUp size={12} /> : <Plus size={12} />}
          {open ? 'Done' : value.length ? 'Add' : 'Add class'}
        </button>
      </div>

      {open && (
        <div className="mt-2 tk-well max-h-56 overflow-y-auto overscroll-contain p-1.5">
          {classes === null ? (
            <p className="px-2 py-2 text-[12.5px] text-slate-500">Loading classes…</p>
          ) : byGrade.length === 0 ? (
            <p className="px-2 py-2 text-[12.5px] text-slate-500">No classes are set up yet.</p>
          ) : byGrade.map(([grade, rows]) => (
            <div key={grade} className="flex items-start gap-2 px-1.5 py-1">
              <span className="w-[4.25rem] flex-shrink-0 pt-1 text-[12px] font-medium text-slate-500 leading-tight">{grade}</span>
              <div className="flex flex-wrap gap-1 min-w-0">
                {rows.map(c => {
                  const on = value.includes(c.label)
                  return (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => toggle(c.label)}
                      aria-pressed={on}
                      aria-label={c.label}
                      title={c.name}
                      className={`min-w-[2rem] h-7 px-2 rounded-[9px] text-[12.5px] font-semibold border transition active:scale-95 ${
                        on
                          ? 'text-white border-transparent bg-gradient-to-br from-amber-500 to-orange-500'
                          : 'bg-white text-slate-600 border-amber-900/[0.12] hover:border-amber-400'}`}
                    >
                      {c.section || c.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
