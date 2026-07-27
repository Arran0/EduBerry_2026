'use client'

// ============================================================
// Formatted text fields — plain <textarea>/<input> wrappers that support
// entering math superscript/subscript directly from the keyboard
// (Ctrl/Cmd + . for superscript, Ctrl/Cmd + , for subscript, mirroring
// Google Docs) as well as pasting formatted content from Word/Docs.
//
// Storage stays plain text: toggling a mode maps subsequent keystrokes to
// their Unicode superscript/subscript equivalents (e.g. "2" -> "²")
// instead of applying real inline formatting, so no schema or rendering
// changes are needed anywhere else in the exam app.
// ============================================================

import React, { useState } from 'react'
import { pasteFormattedText, mapChar } from '@/lib/richPaste'

type ScriptMode = 'normal' | 'sup' | 'sub'

const IGNORED_KEYS = new Set([
  'Backspace', 'Delete', 'Tab', 'Enter', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock',
])

function useScriptField(value: string, onChange: (v: string) => void) {
  const [mode, setMode] = useState<ScriptMode>('normal')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const combo = e.ctrlKey || e.metaKey
    const isPeriod = e.key === '.' || e.code === 'Period'
    const isComma = e.key === ',' || e.code === 'Comma'

    if (combo && isPeriod) {
      e.preventDefault()
      setMode(m => (m === 'sup' ? 'normal' : 'sup'))
      return
    }
    if (combo && isComma) {
      e.preventDefault()
      setMode(m => (m === 'sub' ? 'normal' : 'sub'))
      return
    }
    if (mode === 'normal') return
    if (e.key === 'Escape') {
      e.preventDefault()
      setMode('normal')
      return
    }
    if (combo || e.altKey || IGNORED_KEYS.has(e.key) || e.key.length !== 1) return

    e.preventDefault()
    const target = e.currentTarget
    const start = target.selectionStart ?? value.length
    const end = target.selectionEnd ?? value.length
    const mapped = mapChar(e.key, mode === 'sup' ? 'sup' : 'sub')
    const next = value.slice(0, start) + mapped + value.slice(end)
    onChange(next)
    const caret = start + mapped.length
    requestAnimationFrame(() => {
      try { target.setSelectionRange(caret, caret) } catch { /* target may have unmounted */ }
    })
  }

  const handlePaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>,
    singleLine: boolean,
  ) => {
    pasteFormattedText(e, updater => onChange(updater(value)), { singleLine })
  }

  return { mode, handleKeyDown, handlePaste }
}

const MODE_BADGE: Record<Exclude<ScriptMode, 'normal'>, string> = { sup: 'x²', sub: 'x₂' }

function ModeBadge({ mode, className }: { mode: ScriptMode; className?: string }) {
  if (mode === 'normal') return null
  return (
    <span
      className={`pointer-events-none select-none text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--page-accent-light)] text-[var(--page-accent)] border border-[#E7E2D8] ${className ?? ''}`}
      title={mode === 'sup' ? 'Superscript mode — Ctrl/Cmd+. to exit' : 'Subscript mode — Ctrl/Cmd+, to exit'}
    >
      {MODE_BADGE[mode]}
    </span>
  )
}

export function FormattedTextarea({
  className, rows, value, onChange, placeholder,
}: {
  className?: string
  rows?: number
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const { mode, handleKeyDown, handlePaste } = useScriptField(value, onChange)
  return (
    <div className="relative">
      <textarea
        className={className}
        rows={rows}
        style={mode !== 'normal' ? { paddingRight: '2.75rem' } : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={e => handlePaste(e, false)}
        placeholder={placeholder}
      />
      <ModeBadge mode={mode} className="absolute top-1.5 right-2" />
    </div>
  )
}

export function FormattedInput({
  className, value, onChange, placeholder, wrapperClassName,
}: {
  className?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  wrapperClassName?: string
}) {
  const { mode, handleKeyDown, handlePaste } = useScriptField(value, onChange)
  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <input
        className={className}
        style={mode !== 'normal' ? { paddingRight: '2.75rem' } : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={e => handlePaste(e, true)}
        placeholder={placeholder}
      />
      <ModeBadge mode={mode} className="absolute top-1/2 -translate-y-1/2 right-2" />
    </div>
  )
}
