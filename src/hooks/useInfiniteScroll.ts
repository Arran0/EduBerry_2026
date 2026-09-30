import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface UseInfiniteScrollOptions {
  /** Rows rendered before the reader has scrolled at all. */
  initialCount?: number
  /** Rows revealed each time the sentinel comes into view. */
  step?: number
  /** How far below the fold to start revealing, so rows are already there
   *  by the time the reader reaches them. */
  rootMargin?: string
  /**
   * Changing this starts the list back at the first page. Pass the search term
   * and filter values — deliberately *not* the array itself: these lists are
   * re-created whenever a single row is edited in place, and resetting then
   * would yank a reader who is forty rows down back to the top.
   */
  resetKey?: string | number
}

interface UseInfiniteScrollResult<T> {
  /** The slice to render. */
  visible: T[]
  /** Attach to an element placed after the last row. */
  sentinelRef: (node: HTMLElement | null) => void
  hasMore: boolean
  /** Rows on screen right now (`visible.length`). */
  shown: number
  total: number
  /** Manual fallback for the "Show more" button. */
  loadMore: () => void
}

/**
 * Renders a long list a page at a time, revealing the next page as a sentinel
 * scrolls into view.
 *
 * The admin managers each hold their whole roster in memory already (one paged
 * fetch, then all the filtering and sorting happens locally), so the cost that
 * actually hurts is mounting a thousand animated rows at once. This trims the
 * render, not the fetch.
 *
 * The visible count resets whenever `resetKey` changes, so changing a filter
 * or a search term starts the list back at the top page rather than leaving
 * the reader deep in a list that no longer exists.
 */
export function useInfiniteScroll<T>(
  items: T[],
  { initialCount = 30, step = 30, rootMargin = '600px 0px', resetKey }: UseInfiniteScrollOptions = {},
): UseInfiniteScrollResult<T> {
  const [count, setCount] = useState(initialCount)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const nodeRef = useRef<HTMLElement | null>(null)
  const totalRef = useRef(items.length)
  totalRef.current = items.length

  useEffect(() => { setCount(initialCount) }, [resetKey, initialCount])

  const hasMore = count < items.length

  const loadMore = useCallback(() => {
    setCount(prev => Math.min(prev + step, totalRef.current))
  }, [step])

  // A callback ref rather than a plain one: the sentinel is unmounted as soon
  // as the list is fully revealed and re-mounted when a filter shortens it, and
  // a callback ref is the only form that reliably tells us about both.
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    nodeRef.current = node
    if (!node) return
    observerRef.current = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMore()
    }, { rootMargin })
    observerRef.current.observe(node)
  }, [loadMore, rootMargin])

  // Revealing a page can leave the sentinel still on screen — a tall display,
  // or rows shorter than the observer's margin. The intersection never
  // changes, so it never fires again and the list stalls half-revealed.
  // Re-observing re-reports the current state, which asks for the next page.
  useEffect(() => {
    const node = nodeRef.current
    const io = observerRef.current
    if (!node || !io || !hasMore) return
    io.unobserve(node)
    io.observe(node)
  }, [count, hasMore])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  const visible = useMemo(
    () => (count >= items.length ? items : items.slice(0, count)),
    [items, count],
  )

  return { visible, sentinelRef, hasMore, shown: visible.length, total: items.length, loadMore }
}
