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
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {state === 'error' ? (
        <Chip tone="bad" className="max-w-[9rem] sm:max-w-none">
          <AlertCircle size={10} className="flex-shrink-0" />
          <span className="truncate">{error ?? 'Could not save'}</span>
        </Chip>
      ) : saving ? (
        <Chip tone="neutral"><Loader2 size={10} className="animate-spin" /> Saving</Chip>
      ) : dirtyCount > 0 ? (
        <Chip tone="gold">
          {dirtyCount} unsaved<span className="hidden sm:inline"> · autosaves</span>
        </Chip>
      ) : state === 'saved' ? (
        <Chip tone="good"><Check size={10} /> Saved</Chip>
      ) : null}

      <Btn tone="dark" onClick={onSave} disabled={saving || dirtyCount === 0}>
        <Save size={11} /> Save
      </Btn>
    </div>
  )
}
