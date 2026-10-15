import { useEffect, useRef } from 'react'

/**
 * Tells the home deck whether a self-loading card has anything to show, once
 * its fetch has settled. The deck keeps an empty card mounted (so it can
 * still fetch, and appear in place without a remount if something arrives)
 * but out of the strip and the pager — only Notifications is shown empty.
 *
 * The callback is read through a ref so a parent passing an inline lambda
 * doesn't re-fire the effect on every render.
 */
export function useReportContent(loading: boolean, hasContent: boolean, onContent?: (has: boolean) => void) {
  const ref = useRef(onContent)
  ref.current = onContent
  useEffect(() => {
    if (!loading) ref.current?.(hasContent)
  }, [loading, hasContent])
}
