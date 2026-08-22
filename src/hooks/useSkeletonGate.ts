import { useEffect, useRef, useState } from 'react'

/**
 * True while a loading skeleton should still be shown.
 *
 * If `ready` is already true on the very first render (e.g. state seeded
 * from a cache), the skeleton never shows and there's no delay at all.
 *
 * If the skeleton *did* show (a true first load, nothing cached), once
 * `ready` flips true this keeps it visible for at least `minMs` more —
 * otherwise a skeleton that resolves in a handful of milliseconds just
 * blips in and out, which reads as a flash rather than a loading state.
 */
export function useSkeletonGate(ready: boolean, minMs = 350): boolean {
  const shownAtRef = useRef<number | null>(ready ? null : Date.now())
  const [showSkeleton, setShowSkeleton] = useState(!ready)

  useEffect(() => {
    if (!ready) return
    if (shownAtRef.current === null) {
      setShowSkeleton(false)
      return
    }
    const remaining = Math.max(0, minMs - (Date.now() - shownAtRef.current))
    const t = setTimeout(() => setShowSkeleton(false), remaining)
    return () => clearTimeout(t)
  }, [ready, minMs])

  return showSkeleton
}
