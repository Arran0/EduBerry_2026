'use client'

import React, { useState, useEffect, useRef } from 'react'

/**
 * One editable number in the pay cycle sheet.
 *
 * Reads as plain text until clicked, so a row of these still scans like a
 * spreadsheet rather than a wall of input boxes. An overridden cell is
 * underlined to make clear the figure was typed rather than derived, and
 * clearing the box removes the override so the automatic value comes back.
 *
 * Clicks are kept from reaching the row underneath, which would otherwise
 * expand/collapse the record while someone is trying to edit it.
 */
export default function EditableCell({
  value, derived, editable, align = 'right', format, onSave, title,
}: {
  /** Current effective value (the override if set, otherwise the derived figure). */
  value: number
  /** True when the value is a stored override rather than the derived one. */
  derived: boolean
  editable: boolean
  align?: 'right' | 'center'
  format: (n: number) => string
  /** null clears the override. */
  onSave: (next: number | null) => Promise<void> | void
  title?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // What the box was seeded with, so an untouched cell can be told apart from
  // one deliberately set to the same number.
  const opened = useRef('')

  const begin = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editable) return
    const seed = String(value)
    opened.current = seed
    setDraft(seed)
    setEditing(true)
  }

  const commit = async () => {
    if (saving) return
    const trimmed = draft.trim()

    // Merely clicking a cell and clicking away must not write anything. The box
    // opens pre-filled with the figure on screen, so without this a stray click
    // on a derived cell would store that figure as a manual override — and an
    // override of 0 is indistinguishable from "deduct nothing", permanently
    // pinning the column to zero however the inputs behind it later change.
    if (trimmed === opened.current.trim()) { setEditing(false); return }

    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && !Number.isFinite(next)) { setEditing(false); return }
    setSaving(true)
    await onSave(next)
    setSaving(false)
    setEditing(false)
  }

  const alignCls = align === 'center' ? 'text-center' : 'text-right'

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="any"
        value={draft}
        disabled={saving}
        onClick={e => e.stopPropagation()}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        className={`w-full min-w-0 bg-white border border-[#27272A] rounded px-1 py-0.5 text-[11px] tabular-nums text-[#27272A] focus:outline-none ${alignCls}`}
      />
    )
  }

  return (
    <span
      onClick={begin}
      title={title ?? (editable ? 'Click to edit' : undefined)}
      className={`${alignCls} text-[11px] tabular-nums truncate ${
        editable ? 'cursor-text hover:bg-[#F4F4F5] rounded px-1 -mx-1' : ''
      } ${derived ? 'text-[#71717A]' : 'text-[#18181B] font-semibold underline decoration-dotted decoration-[#B8983C] underline-offset-2'}`}
    >
      {format(value)}
    </span>
  )
}
