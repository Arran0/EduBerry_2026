// Reading profiles from the browser.
//
// `profiles.email` is not readable by signed-in users
// (supabase-migrations/fix_profile_email_visibility_b.sql): a query naming it,
// or `*`, on profiles — directly or embedded — is refused by the database. The
// address comes from profile_emails instead, which shows a student's address
// only to staff and to the student themself, and anyone else's to everyone.
// Embedding it with PostgREST's spread keeps the response shape: a row selected
// with PROFILE_EMAIL still has `email`, null where the reader may not see it.
//
// Searching by name or address goes through profileDirectory below, which
// only matches addresses the caller may see.
// profileColumns.test.ts holds the app to all of this.

import { supabase } from './supabase'

/** The governed address, as `email` on the row it is embedded in. */
export const PROFILE_EMAIL = '...profile_emails(email)'

/** Every profiles column the app may read, plus the governed email — use instead of '*'. */
export const PROFILE_COLUMNS =
  `id, full_name, role, avatar_url, created_at, updated_at, grade, section, is_banned, banned_at, geofence_exempt, is_non_teaching, attendance_hidden, display_role, ${PROFILE_EMAIL}` as const

/** The same columns for rows from profileDirectory, whose `email` is already governed. */
export const DIRECTORY_COLUMNS =
  'id, full_name, role, avatar_url, created_at, updated_at, grade, section, is_banned, banned_at, geofence_exempt, is_non_teaching, attendance_hidden, display_role, email'

/**
 * Profiles to search or look up by name or address: every profile, with `email`
 * where the caller may see it and null elsewhere (the profile_directory RPC).
 * Use it in place of `supabase.from('profiles')` and chain the same
 * `.select()`, filters and ordering — an `email.ilike` or `.eq('email', …)` then
 * matches only addresses the caller may see. Pass `{ count: 'exact' }` for a total.
 */
export function profileDirectory(options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
  return supabase.rpc('profile_directory', {}, options)
}

/** The address shown on someone's profile card; any signed-in viewer may see it. */
export async function fetchProfileCardEmail(profileId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('profile_card_email', { p_profile_id: profileId })
  if (error) {
    console.error('fetchProfileCardEmail error:', error)
    return null
  }
  return (data as string | null) ?? null
}
