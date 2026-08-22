/** Shared image-preload helper for banners — used to decide whether a
 *  banner's entrance reveal is worth playing. */

/**
 * How fast an image must resolve to count as "already in the browser's
 * cache" rather than a real network fetch. A cache hit (memory or disk)
 * typically resolves in well under this; an actual fetch over a real
 * connection takes noticeably longer.
 */
const CACHE_HIT_THRESHOLD_MS = 150

/**
 * Preloads an image and reports whether it resolved fast enough to have
 * come from the browser's own cache. Resolves on both success and failure —
 * a missing/broken image needs no entrance animation either, since there's
 * nothing to reveal.
 */
export function preloadImage(src: string): Promise<{ cached: boolean }> {
  return new Promise(resolve => {
    const startedAt = performance.now()
    const img = new Image()
    const finish = () => resolve({ cached: performance.now() - startedAt < CACHE_HIT_THRESHOLD_MS })
    img.onload = finish
    img.onerror = finish
    img.src = src
  })
}
