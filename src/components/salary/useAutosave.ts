'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/**
 * Periodic autosave for sheet-style editors.
 *
 * Once something becomes dirty a single flush is scheduled `delayMs` later.
 * Later edits inside that window ride along with the same flush rather than
 * pushing it back — a plain debounce would keep deferring the write for as
 * long as someone kept typing across a row of fields, which is exactly when
 * the work is most worth protecting.
 *
 * The returned `saveNow` runs a flush immediately and cancels the pending one,
 * so a manual Save button and the timer can't both fire for the same edits.
 */
export function useAutosave(
  isDirty: boolean,
  flush: () => Promise<{ success: boolean; error?: string }>,
  delayMs = 10_000,
) {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Kept in a ref so the scheduled callback always runs the latest closure
  // without the timer having to be town down and re-created on every edit.
  const flushRef = useRef(flush)
  flushRef.current = flush
  const running = useRef(false)

  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    setState('saving'); setError(null)
    try {
      const res = await flushRef.current()
      if (res.success) {
        setState('saved')
      } else {
        setState('error')
        setError(res.error ?? 'Could not save')
      }
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      running.current = false
    }
  }, [])

  const saveNow = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    await run()
  }, [run])

  useEffect(() => {
    if (!isDirty) return
    setState(s => (s === 'saving' ? s : 'pending'))
    if (timer.current) return   // a flush is already booked; let it collect this edit too
    timer.current = setTimeout(() => {
      timer.current = null
      run()
    }, delayMs)
  }, [isDirty, delayMs, run])

  // Clear the booking on unmount so a flush can't fire against a dead component.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Last line of defence: warn before the tab closes with edits still queued.
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  return { state, error, saveNow }
}
