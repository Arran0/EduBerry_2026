'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, UserPlus, X } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { gradeLabel } from '@/lib/grades'
import {
  MESSAGE_KIND_LABELS, MESSAGE_KIND_PILL, STUDENT_SEARCH_MIN_CHARS,
  searchStudentsForMessage, type MessageCandidate,
} from '@/lib/attendanceWhatsApp'

/**
 * Add one student to the bulk list by hand.
 *
 * The filters above cover "every absent student in Grade 8B". This covers the
 * other half of how an office actually works: the parent who rang, the child
 * the class teacher mentioned in the corridor, the one whose sheet was marked
 * late after the list was already on screen. Searching the roll is the only way
 * to reach them, because by definition they are not what the filter selected.
 *
 * Deliberately server-side. The roll is thousands of rows and a class teacher
 * may only search their own students — a filter over a client-side cache would
 * either ship the whole roll to every teacher's browser or quietly search less
 * than it claims to.
 */
export default function StudentTypeahead({
  date, onPick, excludeIds,
}: {
  date: string
  onPick: (student: MessageCandidate) => void
  /** Already in the list — shown as "added" rather than hidden, so searching
   *  for someone who is already there says so instead of finding nothing. */
  excludeIds: Set<string>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MessageCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Identifies the newest request, so a slow early response cannot overwrite
  // the results of a later, more specific query.
  const runRef = useRef(0)

  const run = useCallback(async (q: string) => {
    const run = ++runRef.current
    if (q.trim().length < STUDENT_SEARCH_MIN_CHARS) {
      setResults([]); setSearching(false)
      return
    }
    setSearching(true)
    const rows = await searchStudentsForMessage(q, date)
    if (runRef.current !== run) return
    setResults(rows)
    setSearching(false)
  }, [date])

  // Debounced: a query per keystroke would be a round trip per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void run(query), 220)
    return () => clearTimeout(t)
  }, [query, run])

  // A new date invalidates every result — each row carries that date's status.
  useEffect(() => { setResults([]) }, [date])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (row: MessageCandidate) => {
    if (excludeIds.has(row.student_id)) return
    onPick(row)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const short = query.trim().length > 0 && query.trim().length < STUDENT_SEARCH_MIN_CHARS

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Add a student by name, admission no or roll no…"
          className="w-full pl-8 pr-8 py-2 text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-[#27272A] rounded-md"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
          {searching
            ? <Loader2 size={13} className="animate-spin text-[#A1A1AA]" />
            : query
              ? (
                <button onClick={() => { setQuery(''); setResults([]) }} aria-label="Clear search">
                  <X size={13} className="text-[#A1A1AA] hover:text-[#18181B]" />
                </button>
              )
              : <UserPlus size={13} className="text-[#A1A1AA]" />}
        </span>
      </div>

      {open && (short || results.length > 0 || (!searching && query.trim().length >= STUDENT_SEARCH_MIN_CHARS)) && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-[#D4D4D8] rounded-lg shadow-lg">
          {short ? (
            <p className="px-3 py-2.5 text-xs text-[#A1A1AA]">
              Type at least {STUDENT_SEARCH_MIN_CHARS} characters.
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-[#A1A1AA]">No students match that.</p>
          ) : (
            results.map(row => {
              const added = excludeIds.has(row.student_id)
              const klass = row.homeroom_name
                || [row.grade != null ? gradeLabel(row.grade) : '', row.section ?? ''].filter(Boolean).join(' ')
              return (
                <button
                  key={row.student_id}
                  onClick={() => pick(row)}
                  disabled={added}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#FAFAF9] disabled:bg-[#FAFAF9] disabled:cursor-default border-b border-[#F4F4F5] last:border-b-0"
                >
                  <Avatar
                    avatarUrl={row.avatar_url} name={row.full_name}
                    email={row.email ?? undefined} size={24} userId={row.student_id}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-[#18181B] truncate">{row.full_name}</span>
                    {klass && <span className="block text-[11px] text-[#A1A1AA] truncate">{klass}</span>}
                  </span>
                  {row.kind ? (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${MESSAGE_KIND_PILL[row.kind]}`}>
                      {MESSAGE_KIND_LABELS[row.kind]}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#A1A1AA] flex-shrink-0">
                      {row.status === 'present' ? 'Present' : 'Not marked'}
                    </span>
                  )}
                  {added && <span className="text-[10px] font-semibold text-emerald-600 flex-shrink-0">Added</span>}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
