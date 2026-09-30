import { useCallback, useEffect, useRef, useState } from 'react'

export interface FetchedPage<T> {
  rows: T[]
  /** How many rows match in total, so the list knows when to stop asking. */
  total: number
}

export type PageFetcher<T> = (offset: number, limit: number) => Promise<FetchedPage<T>>

interface UseServerPagedListOptions {
  pageSize?: number
  /**
   * Changing this re-runs the query from the first page. Pass the search text
   * and filter values; it is what tells the hook the *query* changed rather
   * than the data behind it.
   */
  resetKey?: string
  /** How far below the fold to fetch the next page. */
  rootMargin?: string
}

export interface UseServerPagedListResult<T> {
  rows: T[]
  total: number
  /** True only while the first page of a new query is in flight. */
  loading: boolean
  /** True while a later page is being appended. */
  loadingMore: boolean
  hasMore: boolean
  /** Attach to an element placed after the last row. */
  sentinelRef: (node: HTMLElement | null) => void
  loadMore: () => void
  /** Re-reads everything already on screen — after a create, ban or delete. */
  reload: () => Promise<void>
}

/**
 * A list that lives in the database, read a page at a time.
 *
 * This is the difference between rendering 30 rows and *fetching* 30 rows. The
 * admin managers used to pull their whole table — every column of every row,
 * a thousand students in two round trips — and then search, sort and count it
 * in the browser. Here the query does all of that, and the browser never holds
 * more than the reader has actually scrolled to.
 *
 * Every page request carries a run number. A reply from a superseded query
 * (the reader typed another letter while it was in flight) is dropped rather
 * than appended, which is what keeps a fast typist from ending up with two
 * different searches interleaved in one list.
 */
export function useServerPagedList<T>(
  fetchPage: PageFetcher<T>,
  { pageSize = 30, resetKey = '', rootMargin = '600px 0px' }: UseServerPagedListOptions = {},
): UseServerPagedListResult<T> {
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Kept in refs so loadMore/reload stay stable across renders — they are
  // handed to an IntersectionObserver, which should not be torn down and
  // rebuilt every time a row arrives.
  const runRef = useRef(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const rowsRef = useRef<T[]>(rows)
  rowsRef.current = rows
  const totalRef = useRef(0)
  totalRef.current = total
  const inFlightRef = useRef(false)

  // First page, and every time the query itself changes.
  useEffect(() => {
    const run = ++runRef.current
    inFlightRef.current = false
    setLoading(true)
    setRows([])
    fetchRef.current(0, pageSize).then(page => {
      if (run !== runRef.current) return
      setRows(page.rows)
      setTotal(page.total)
      setLoading(false)
    })
  }, [resetKey, pageSize])

  const loadMore = useCallback(() => {
    if (inFlightRef.current) return
    if (rowsRef.current.length >= totalRef.current) return
    inFlightRef.current = true
    setLoadingMore(true)
    const run = runRef.current
    const offset = rowsRef.current.length
    fetchRef.current(offset, pageSize).then(page => {
      inFlightRef.current = false
      if (run !== runRef.current) return
      setLoadingMore(false)
      setTotal(page.total)
      // Offset paging can hand back a row already on screen if something was
      // inserted behind the reader — key collisions in React are worse than a
      // missing row, so identity wins.
      setRows(prev => {
        const seen = new Set(prev.map(r => (r as { id?: string }).id))
        return [...prev, ...page.rows.filter(r => !seen.has((r as { id?: string }).id))]
      })
    })
  }, [pageSize])

  /**
   * Re-reads as many rows as are currently on screen, in one request, so a
   * refresh after an edit leaves the reader where they were instead of
   * collapsing the list back to its first page.
   */
  const reload = useCallback(async () => {
    const run = ++runRef.current
    inFlightRef.current = false
    setLoading(rowsRef.current.length === 0)
    const want = Math.max(pageSize, rowsRef.current.length)
    const page = await fetchRef.current(0, want)
    if (run !== runRef.current) return
    setRows(page.rows)
    setTotal(page.total)
    setLoading(false)
  }, [pageSize])

  const hasMore = rows.length < total

  const observerRef = useRef<IntersectionObserver | null>(null)
  const nodeRef = useRef<HTMLElement | null>(null)
  const hasMoreRef = useRef(hasMore)
  hasMoreRef.current = hasMore

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    nodeRef.current = node
    if (!node) return
    observerRef.current = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && hasMoreRef.current) loadMore()
    }, { rootMargin })
    observerRef.current.observe(node)
  }, [loadMore, rootMargin])

  // A page can arrive without moving the sentinel off screen — a tall display,
  // or a page of rows shorter than the observer's margin. The intersection
  // never changes, so the observer never fires again and the list stalls
  // half-loaded. Re-observing after each page re-reports the current state,
  // which asks for the next one.
  useEffect(() => {
    const node = nodeRef.current
    const io = observerRef.current
    if (!node || !io || !hasMore) return
    io.unobserve(node)
    io.observe(node)
  }, [rows, hasMore])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return { rows, total, loading, loadingMore, hasMore, sentinelRef, loadMore, reload }
}
