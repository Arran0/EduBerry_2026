'use client'

import React from 'react'
import { Check, Loader2, AlertCircle, Save } from 'lucide-react'
import { Btn, Chip } from '@/components/salary/ui'
import { SaveState } from '@/components/salary/useAutosave'

/**
 * One save control for a whole sheet, replacing a Save button on every row.
 * States it through so nobody has to wonder whether their typing was kept:
 * queued edits are counted, the write is announced while it runs, and a
 * failure stays on screen with its reason instead of disappearing.
 *
 * On a phone the wording collapses to the count alone — "3 unsaved" beside a
 * button that says Save is the whole message, and the long form would push
 * the search field it shares a row with down to nothing.
 */
export default function SaveBar({ dirtyCount, state, error, onSave }: {
  dirtyCount: number
  state: SaveState
  error: string | null
  onSave: () => void
}) {
  const saving = state === 'saving'

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
      {state === 'error' ? (
        // Wraps rather than truncating: the reason is the part worth reading.
        <span className="inline-flex items-start gap-1 min-w-0 text-[12px] leading-snug text-[#A93232] break-words">
          <AlertCircle size={13} className="flex-shrink-0 mt-px" />
          {error ?? 'Could not save'}
        </span>
      ) : saving ? (
        <Chip tone="neutral"><Loader2 size={11} className="animate-spin" /> Saving</Chip>
      ) : dirtyCount > 0 ? (
        <Chip tone="gold">
          {dirtyCount} unsaved<span className="hidden sm:inline"> · saves itself</span>
        </Chip>
      ) : state === 'saved' ? (
        <Chip tone="good"><Check size={11} /> Saved</Chip>
      ) : null}

      <Btn tone="dark" onClick={onSave} disabled={saving || dirtyCount === 0}>
        <Save size={13} /> Save
      </Btn>
    </div>
  )
}
