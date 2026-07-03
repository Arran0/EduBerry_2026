'use client'

import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value` that only updates after `delay`
 * milliseconds have passed without `value` changing. Replaces the ad-hoc
 * setTimeout-in-useEffect debouncing scattered across the app.
 *
 * The class-teacher / student typeaheads in the timetable workspace use the
 * default 500ms delay.
 */
export default function useDebounce<T>(value: T, delay = 500): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])

  return debounced
}
