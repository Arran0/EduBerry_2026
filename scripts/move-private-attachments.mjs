#!/usr/bin/env node
// Move leave, task comment and announcement files out of the public bucket.
//
// fix_private_attachments.sql gives these files a private bucket and makes new
// uploads go there. This moves the ones uploaded before: every object under
// leave/, task-comments/ and announcements/ in `classroom-files` is moved to the
// same path in `private-files`, and every row that pointed at its public URL is
// rewritten to the private reference ('private-file:<path>') the app now signs.
// Objects that no row references any more (from deleted applications, say) are
// moved too, so they stop being public; nobody but an admin can read them.
//
// Run the migration first. Then, from the repo root:
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/move-private-attachments.mjs            # dry run: prints the plan
//   ... node scripts/move-private-attachments.mjs --apply  # does it
//
// Safe to run again: moved files are gone from the public bucket, and rows
// already holding a private reference are left alone.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const apply = process.argv.includes('--apply')
if (!url || !key) {
  console.error('Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const FROM = 'classroom-files'
const TO = 'private-files'
const PREFIXES = ['leave', 'task-comments', 'announcements']
const REF = 'private-file:'
const PUBLIC_MARK = `/storage/v1/object/public/${FROM}/`

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

/** Every object path under a prefix, walking folders. */
async function listAll(prefix) {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(FROM).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`list ${prefix}: ${error.message}`)
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`
      if (entry.id) out.push(path)
      else out.push(...await listAll(path))
    }
    if (!data || data.length < 1000) return out
  }
}

/** The storage path a stored public URL points at, if it is one of ours. */
function pathOf(stored) {
  if (typeof stored !== 'string') return null
  const at = stored.indexOf(PUBLIC_MARK)
  if (at === -1) return null
  const path = decodeURIComponent(stored.slice(at + PUBLIC_MARK.length).split('?')[0])
  return PREFIXES.includes(path.split('/')[0]) ? path : null
}

const paths = (await Promise.all(PREFIXES.map(listAll))).flat()
console.log(`${paths.length} file(s) to move from ${FROM} to ${TO}.`)

// Rows that reference those files.
const rowUpdates = []
for (const table of ['leave_applications', 'leave_approvals', 'task_comments']) {
  const { data, error } = await db.from(table).select('id, attachment_url').like('attachment_url', `%${PUBLIC_MARK}%`)
  if (error) throw new Error(`${table}: ${error.message}`)
  for (const row of data ?? []) {
    const path = pathOf(row.attachment_url)
    if (path) rowUpdates.push({ table, id: row.id, patch: { attachment_url: REF + path } })
  }
}
{
  const { data, error } = await db.from('announcements').select('id, attachments').not('attachments', 'is', null)
  if (error) throw new Error(`announcements: ${error.message}`)
  for (const row of data ?? []) {
    if (!Array.isArray(row.attachments)) continue
    let changed = false
    const attachments = row.attachments.map(a => {
      const path = pathOf(a?.url)
      if (!path) return a
      changed = true
      return { ...a, url: REF + path }
    })
    if (changed) rowUpdates.push({ table: 'announcements', id: row.id, patch: { attachments } })
  }
}
console.log(`${rowUpdates.length} row(s) to rewrite.`)

if (!apply) {
  for (const p of paths) console.log(`  move  ${p}`)
  for (const u of rowUpdates) console.log(`  row   ${u.table} ${u.id}`)
  console.log('Dry run. Re-run with --apply to move the files and rewrite the rows.')
  process.exit(0)
}

const failed = []
const inPrivate = new Set()
for (const path of paths) {
  const { error } = await db.storage.from(FROM).move(path, path, { destinationBucket: TO })
  if (error) failed.push(`${path}: ${error.message}`)
  else inPrivate.add(path)
}
console.log(`Moved ${inPrivate.size} of ${paths.length} file(s).`)

/** A row is rewritten only once its file is in the private bucket — moved now,
 *  or by an earlier run that stopped before rewriting the row. */
async function isPrivate(path) {
  if (inPrivate.has(path)) return true
  const { error } = await db.storage.from(TO).createSignedUrl(path, 60)
  if (error) return false
  inPrivate.add(path)
  return true
}

let rewritten = 0
for (const u of rowUpdates) {
  const refs = u.table === 'announcements'
    ? u.patch.attachments.map(a => a?.url).filter(v => typeof v === 'string' && v.startsWith(REF))
    : [u.patch.attachment_url]
  const missing = []
  for (const ref of refs) if (!await isPrivate(ref.slice(REF.length))) missing.push(ref.slice(REF.length))
  if (missing.length) {
    failed.push(`${u.table} ${u.id}: left as is, file not in ${TO}: ${missing.join(', ')}`)
    continue
  }
  const { error } = await db.from(u.table).update(u.patch).eq('id', u.id)
  if (error) failed.push(`${u.table} ${u.id}: ${error.message}`)
  else rewritten++
}
console.log(`Rewrote ${rewritten} of ${rowUpdates.length} row(s).`)

if (failed.length) {
  console.error(`${failed.length} problem(s):`)
  for (const f of failed) console.error(`  ${f}`)
  process.exit(1)
}
