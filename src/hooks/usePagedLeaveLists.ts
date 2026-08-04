'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LEAVE_PAGE_SIZE, type LeavePage, type LeaveApplicationWithDetails } from '@/lib/leave'

export interface PagedLeaveList {
  items: LeaveApplicationWithDetails[]
  /** Total rows behind the list, not just the loaded ones — drives tab counts. */
  total: number
  hasMore: boolean
  loadingMore: boolean
}

/** Fetches one window of a list. Given to `load`, then reused by `loadMore`. */
export type LeavePageLoader = (offset: number, limit: number) => Promise<LeavePage>

const EMPTY_LIST: PagedLeaveList = { items: [], total: 0, hasMore: false, loadingMore: false }

/**
 * Holds the named "load 10 more" lists of a leave page.
 *
 * Every list starts as a single 10-row query and grows 10 at a time, so
 * opening the page never pulls a queue of applications the user hasn't
 * scrolled to. Each list remembers the loader that produced it, which is what
 * lets `loadMore` fetch only the next window and `load` re-run afterwards
 * without collapsing the list back to its first page.
 */
export function usePagedLeaveLists<K extends string>() {
  const [lists, setLists] = useState<Partial<Record<K, PagedLeaveList>>>({})
  const loaders = useRef<Partial<Record<K, LeavePageLoader>>>({})
  const listsRef = useRef<Partial<Record<K, PagedLeaveList>>>({})

  useEffect(() => { listsRef.current = lists }, [lists])

  const get = useCallback((key: K): PagedLeaveList => lists[key] ?? EMPTY_LIST, [lists])

  /**
   * Loads a list from the top and registers its loader. Re-running it (after
   * an approval decision, say) keeps however many rows are already on screen
   * rather than dropping the user back to the first 10.
   */
  const load = useCallback(async (key: K, loader: LeavePageLoader) => {
    loaders.current[key] = loader
    const window = Math.max(listsRef.current[key]?.items.length ?? 0, LEAVE_PAGE_SIZE)
    const page = await loader(0, window)
    setLists(prev => ({ ...prev, [key]: { ...page, loadingMore: false } }))
  }, [])

  const loadMore = useCallback(async (key: K) => {
    const loader = loaders.current[key]
    const current = listsRef.current[key]
    if (!loader || !current || !current.hasMore || current.loadingMore) return

    setLists(prev => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_LIST), loadingMore: true } }))
    const page = await loader(current.items.length, LEAVE_PAGE_SIZE)
    setLists(prev => {
      const list = prev[key] ?? EMPTY_LIST
      return {
        ...prev,
        [key]: {
          items: [...list.items, ...page.items],
          total: page.total,
          hasMore: page.hasMore,
          loadingMore: false,
        },
      }
    })
  }, [])

  return { get, load, loadMore }
}
