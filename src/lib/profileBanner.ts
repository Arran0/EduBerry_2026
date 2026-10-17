'use client'

import { fetchRawSetting } from '@/lib/pageConfig'

/**
 * The profile card's banner — one site-wide image, the same on every card.
 *
 * Kept on this device rather than fetched per open. Fetching it per open drew
 * the header as the dark fallback gradient and then swapped the photo in a
 * moment later, which read as a black blink on every card. Now:
 *
 *   - the URL is remembered in localStorage, so the very first card of a visit
 *     already knows which image to draw;
 *   - the image is downloaded and decoded as soon as the app mounts the card
 *     host, long before anyone opens a card;
 *   - the setting is re-read once per visit in the background, and only when
 *     the admin has actually changed it (every upload gets a new URL) is the
 *     cached copy replaced and the new image swapped in.
 *
 * '' in storage means "the school has no banner" — distinct from a missing key,
 * which means "never asked yet".
 */

const STORAGE_KEY = 'profile_banner_url'

/** undefined until storage has been read. null = no banner set. */
let current: string | null | undefined
let revalidating: Promise<void> | null = null
const decoded = new Set<string>()
const listeners = new Set<(url: string | null) => void>()

function readStorage(): string | null | undefined {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === null) return undefined
    return v || null
  } catch {
    return undefined
  }
}

function writeStorage(url: string | null) {
  try { window.localStorage.setItem(STORAGE_KEY, url ?? '') } catch { /* private mode */ }
}

/** Download and decode the image off-screen, once per URL. */
function preload(url: string): Promise<void> {
  if (decoded.has(url)) return Promise.resolve()
  return new Promise(resolve => {
    const img = new window.Image()
    const done = () => { decoded.add(url); resolve() }
    img.onload = () => { (img.decode ? img.decode() : Promise.resolve()).then(done, done) }
    img.onerror = () => resolve()
    img.src = url
  })
}

/**
 * The banner as this device last knew it: a URL, null for "none set", or
 * undefined when it has never been asked (a first visit).
 */
export function getCachedProfileBanner(): string | null | undefined {
  if (typeof window === 'undefined') return undefined
  if (current === undefined) current = readStorage()
  return current
}

/** Whether the image has finished decoding, so it can paint without a fade. */
export function isProfileBannerDecoded(url: string): boolean {
  return decoded.has(url)
}

/** Waits for one URL to be decoded (resolves straight away if it already is). */
export function decodeProfileBanner(url: string): Promise<void> {
  return preload(url)
}

/** Records a new banner — called by whoever just saved one, and by revalidation. */
export function setProfileBanner(url: string | null) {
  const next = url || null
  writeStorage(next)
  if (next === current) return
  const apply = () => {
    current = next
    listeners.forEach(fn => fn(next))
  }
  // Swap only once the new image is ready to paint, so an open card goes
  // straight from the old photo to the new one with nothing in between.
  if (next) preload(next).then(apply)
  else apply()
}

export function subscribeProfileBanner(fn: (url: string | null) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Warm the cache: decode what this device already has, then check the setting
 * once for this visit. Safe to call repeatedly.
 */
export function warmProfileBanner(): Promise<void> {
  const cached = getCachedProfileBanner()
  if (cached) preload(cached)
  if (!revalidating) {
    revalidating = fetchRawSetting<string>('profile_banner')
      .then(url => {
        // A string ('' once an admin clears it) is an answer. null is also
        // what a failed read returns, so it only counts as "no banner" when
        // there is nothing cached to protect.
        if (typeof url === 'string') setProfileBanner(url || null)
        else if (current === undefined) setProfileBanner(null)
      })
      .catch(() => { /* keep the cached copy */ })
  }
  return revalidating
}
