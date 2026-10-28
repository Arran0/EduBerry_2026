'use client'

import { useEffect, useMemo, useState } from 'react'
import { cachedFileUrl, privateFilePath, renewAt, resolveFileUrl } from '@/lib/privateFiles'

/**
 * The URL to show for what a row holds (see lib/privateFiles): a plain URL as
 * it is, a private reference as a signed URL. `undefined` while it is being
 * signed, `null` when the viewer may not open it. A page left open longer than
 * the URL lasts gets a fresh one.
 */
export function usePrivateFileUrl(ref: string | null | undefined): string | null | undefined {
  const resolver = usePrivateFileUrls(useMemo(() => [ref], [ref]))
  return resolver(ref)
}

/**
 * The same for a list — every reference in it is signed in one request.
 * Returns a lookup from what the row holds to the URL to show.
 */
export function usePrivateFileUrls(
  refs: (string | null | undefined)[],
): (ref: string | null | undefined) => string | null | undefined {
  const key = useMemo(() => [...new Set(refs.filter(r => !!privateFilePath(r)))].sort().join('\n'), [refs])
  const [urls, setUrls] = useState<Map<string, string | null>>(() => new Map())
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!key) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const wanted = key.split('\n')
    Promise.all(wanted.map(r => resolveFileUrl(r).then(url => [r, url] as const)))
      .then(pairs => {
        if (!live) return
        setUrls(new Map(pairs))
        // Sign again once the soonest of these URLs is due for renewal.
        const due = Math.min(...wanted.map(r => renewAt(r) ?? Infinity))
        if (Number.isFinite(due)) timer = setTimeout(() => setRound(n => n + 1), Math.max(due - Date.now(), 0) + 1000)
      })
    return () => { live = false; if (timer) clearTimeout(timer) }
  }, [key, round])

  return (ref: string | null | undefined) => {
    if (!privateFilePath(ref)) return ref ?? null
    if (urls.has(ref!)) return urls.get(ref!)
    return cachedFileUrl(ref)
  }
}
