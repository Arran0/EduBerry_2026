import { supabase } from './supabase'

// Files only some people may open: leave attachments, task and subtask comment
// attachments, announcement files.
//
// They live in the private `private-files` bucket. A row stores a reference,
// 'private-file:<path>', never a URL; the database lets a person read the file
// when they can read the row that references it (can_read_private_file, see
// supabase-migrations/fix_private_attachments.sql). To show one, the app asks
// storage for a signed URL that works for an hour.
//
// Rows written before the move still hold public URLs. Everything here passes
// those through unchanged, so a screen can resolve whatever the row holds.

export const PRIVATE_BUCKET = 'private-files'

const REF_PREFIX = 'private-file:'

/** How long a signed URL works. */
export const SIGNED_URL_SECONDS = 3600

/** A cached URL is signed again when it has less than this left. */
export const RENEW_BEFORE_MS = 5 * 60_000

export function privateFileRef(path: string): string {
  return REF_PREFIX + path
}

/** The storage path behind a reference, or null when `ref` is not one. */
export function privateFilePath(ref: string | null | undefined): string | null {
  return ref && ref.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : null
}

/** Upload to the private bucket; the reference to store, or null on failure. */
export async function uploadPrivateFile(path: string, file: Blob): Promise<string | null> {
  const { error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    // Never upsert: a path collision must not overwrite someone else's file.
    .upload(path, file, { upsert: false, cacheControl: String(SIGNED_URL_SECONDS) })
  if (error) {
    console.error('Private file upload failed:', error)
    return null
  }
  return privateFileRef(path)
}

const signed = new Map<string, { url: string; until: number }>()
let pending: Map<string, ((url: string | null) => void)[]> | null = null

/**
 * A URL for whatever a row holds: a signed URL for a private reference (null
 * when the viewer may not open it), anything else unchanged.
 *
 * Every reference asked for in the same tick is signed in one request, so a
 * list of thirty comments costs one round trip, not thirty, and a URL is reused
 * until it is close to expiring.
 */
export function resolveFileUrl(ref: string | null | undefined): Promise<string | null> {
  const path = privateFilePath(ref)
  if (!path) return Promise.resolve(ref ?? null)
  const hit = signed.get(path)
  if (hit && hit.until - Date.now() > RENEW_BEFORE_MS) return Promise.resolve(hit.url)
  return new Promise(resolve => {
    if (!pending) {
      pending = new Map()
      queueMicrotask(signPending)
    }
    const waiting = pending.get(path) ?? []
    waiting.push(resolve)
    pending.set(path, waiting)
  })
}

/** The cached URL for a reference, if one is still good; never a request. */
export function cachedFileUrl(ref: string | null | undefined): string | null | undefined {
  const path = privateFilePath(ref)
  if (!path) return ref ?? null
  const hit = signed.get(path)
  return hit && hit.until - Date.now() > RENEW_BEFORE_MS ? hit.url : undefined
}

/** When the cached URL for a reference stops being reused (ms since epoch). */
export function renewAt(ref: string | null | undefined): number | undefined {
  const path = privateFilePath(ref)
  const hit = path ? signed.get(path) : undefined
  return hit ? hit.until - RENEW_BEFORE_MS : undefined
}

async function signPending() {
  const batch = pending
  pending = null
  if (!batch) return
  const paths = [...batch.keys()]
  const until = Date.now() + SIGNED_URL_SECONDS * 1000
  const byPath = new Map<string, string>()
  try {
    const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
    if (error) console.error('Signing private files failed:', error)
    for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) byPath.set(row.path, row.signedUrl)
    }
  } catch (err) {
    console.error('Signing private files failed:', err)
  }
  for (const [path, waiting] of batch) {
    const url = byPath.get(path) ?? null
    if (url) signed.set(path, { url, until })
    for (const resolve of waiting) resolve(url)
  }
}
