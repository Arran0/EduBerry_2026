'use client'

import { useEffect, useRef, useState } from 'react'

/** Beat between one row landing and the next starting. */
const ROW_INTERVAL_MS = 130

/**
 * Reveals a grid's rows one at a time on its first load: the skeleton row is
 * already on screen, so the rows behind it arrive in turn, each one growing
 * the grid and easing whatever sits below it further down the page.
 *
 * Only the first batch is staged. Rows the auto-loader appends later just
 * appear — by then the reader is looking at the grid, and dealing them out a
 * row at a time would read as lag rather than as the page settling.
 *
 * @param totalRows rows the current batch fills (0 while loading)
 * @param ready     true once the real classrooms are in hand
 * @returns rows to show right now; Infinity once the staged reveal is done
 */
export function useStaggeredRows(totalRows: number, ready: boolean): number {
  const [revealed, setRevealed] = useState(1)
  // Latches once the first batch has finished dealing itself out, so later
  // rows — and re-renders from filtering or sorting — skip the stagger.
  const doneRef = useRef(false)

  useEffect(() => {
    if (!ready || doneRef.current) return
    if (totalRows <= 1) {
      doneRef.current = true
      setRevealed(Infinity)
      return
    }
    let row = 1
    const id = window.setInterval(() => {
      row += 1
      setRevealed(row)
      if (row >= totalRows) {
        window.clearInterval(id)
        doneRef.current = true
        // Hand the cap back so nothing clamps the grid from here on.
        setRevealed(Infinity)
      }
    }, ROW_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [ready, totalRows])

  return doneRef.current ? Infinity : revealed
}
