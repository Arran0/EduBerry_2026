import { useCallback, useEffect, useRef, useState } from 'react'

interface UseAutoLoadMoreOptions {
  /** Total number of items available. */
  total: number
  /** Number of items visible up front. */
  initialCount: number
  /** Items to reveal per load. */
  step: number
  /** How long to wait before an unattended auto-load fires. */
  intervalMs: number
}

interface UseAutoLoadMoreResult {
  visibleCount: number
  hasMore: boolean
  /** Attach to the scrollable list — used to auto-scroll newly revealed items into view. */
  containerRef: React.RefObject<HTMLDivElement>
  /** Call from a "Load more" button. */
  loadMore: () => void
  /** Attach to the scrollable container's onScroll — resets the auto-load countdown. */
  handleScroll: () => void
}

/**
 * Drives a "load 4 more" list that also auto-advances on a timer, pausing
 * the countdown whenever the user scrolls and stopping for good once
 * everything has been revealed.
 */
export function useAutoLoadMore({ total, initialCount, step, intervalMs }: UseAutoLoadMoreOptions): UseAutoLoadMoreResult {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(initialCount, total))
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoScrollingRef = useRef(false)
  // Once the user has loaded past the first page, `initialCount` (e.g. a
  // resize changing the column count) and `total` (async data arriving)
  // should stop rewriting visibleCount — only clamp it if the list shrinks.
  const pastFirstPageRef = useRef(false)

  const hasMore = visibleCount < total

  // `total` starts at 0 while classrooms are still loading, and `initialCount`
  // changes with the live column count (see useGridColumns) — keep the first
  // page in sync with both until the user actually advances past it.
  useEffect(() => {
    if (pastFirstPageRef.current) {
      setVisibleCount(prev => Math.min(prev, total))
      return
    }
    setVisibleCount(Math.min(initialCount, total))
  }, [total, initialCount])

  const reveal = useCallback(() => {
    pastFirstPageRef.current = true
    setVisibleCount(prev => Math.min(prev + step, total))
  }, [step, total])

  // Scroll newly revealed cards into view — but not for the first page, which
  // is already on screen (only fires once we've gone past initialCount).
  useEffect(() => {
    if (visibleCount <= initialCount) return
    const el = containerRef.current
    if (!el) return
    autoScrollingRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    const t = window.setTimeout(() => { autoScrollingRef.current = false }, 600)
    return () => window.clearTimeout(t)
  }, [visibleCount, initialCount])

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])

  const armTimer = useCallback(() => {
    clearTimer()
    if (visibleCount >= total) return
    timerRef.current = setTimeout(reveal, intervalMs)
  }, [clearTimer, intervalMs, reveal, total, visibleCount])

  // (Re-)arm whenever the visible count changes — covers both auto-loads and manual ones.
  useEffect(() => {
    armTimer()
    return clearTimer
  }, [armTimer, clearTimer])

  const loadMore = useCallback(() => {
    reveal()
  }, [reveal])

  const handleScroll = useCallback(() => {
    if (autoScrollingRef.current) return
    armTimer()
  }, [armTimer])

  return { visibleCount, hasMore, containerRef, loadMore, handleScroll }
}
