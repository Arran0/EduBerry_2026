// Tiny localStorage cache so a banner's last-known config paints on the very
// first render (no default → fetched-value flash), while the calling
// component still re-fetches in the background and overwrites the cache the
// moment an admin changes it — so nothing ever goes stale beyond one load.
//
// Returns `undefined` when nothing is cached yet (as opposed to `null`, which
// is a legitimate cached value for e.g. "no custom photo set") — callers use
// that distinction to show a neutral loading skeleton only on a true first
// visit, never a wrong-then-corrected flash of content.

const PREFIX = 'banner-cache:'

export function readBannerCache<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}

export function writeBannerCache<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or disabled (e.g. private browsing) — safe to skip, the
    // next fetch just repopulates state without the cache assist.
  }
}
