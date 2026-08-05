'use client'

import React from 'react'
import { Check, Loader2, AlertCircle, Save } from 'lucide-react'
import { ADMIN } from '@/components/salary/adminUi'
import { SaveState } from '@/components/salary/useAutosave'

/**
 * One save control for a whole sheet, replacing a Save button on every row.
 * States it through so nobody has to wonder whether their typing was kept:
 * queued edits are counted, the write is announced while it runs, and a
 * failure stays on screen with its reason instead of disappearing.
 */
export default function SaveBar({ dirtyCount, state, error, onSave }: {
  dirtyCount: number
  state: SaveState
  error: string | null
  onSave: () => void
}) {
  const saving = state === 'saving'

  return (
    <div className="flex items-center gap-2 min-h-[32px]">
      {state === 'error' ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-600">
          <AlertCircle size={13} /> {error ?? 'Could not save'}
        </span>
      ) : saving ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#71717A]">
          <Loader2 size={13} className="animate-spin" /> Saving…
        </span>
      ) : dirtyCount > 0 ? (
        <span className="text-[11px] font-semibold text-[#8A6D1F]">
          {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'} · saves automatically
        </span>
      ) : state === 'saved' ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
          <Check size={13} /> All changes saved
        </span>
      ) : null}

      <button
        onClick={onSave}
        disabled={saving || dirtyCount === 0}
        className={`${ADMIN.darkBtn} text-[11px] px-2.5 py-1.5 disabled:opacity-40`}
      >
        <Save size={12} /> Save now
      </button>
    </div>
  )
}
