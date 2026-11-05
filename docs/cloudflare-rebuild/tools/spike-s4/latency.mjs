// Spike S4, part A: how long one database round trip takes from this machine to
// Neon in Singapore, compared with Supabase in Mumbai (today's database).
// Run it from India, on each network that matters (home or school broadband,
// a Jio hotspot, an Airtel hotspot). See README.md in this folder.
//
// Environment:
//   NEON_URL         Neon pooled connection string (required). Never commit it.
//   SUPABASE_URL     Supabase project URL (defaults to the live project's public URL)
//   SUPABASE_ANON_KEY  The public anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local), for the
//                    test that reads one row through Supabase's API, as today's browser does
//   SUPABASE_DB_URL  Optional: Supabase session-pooler connection string, for a like-for-like Postgres test
//   SUPABASE_CA      Optional: path to Supabase's CA certificate, if the TLS check fails for SUPABASE_DB_URL
// Flags: --n 30 (round trips per test), --label jio, --only neon-http

import { neon } from '@neondatabase/serverless'
import pg from 'pg'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def }
const N = Number(flag('--n', 30))
const LABEL = flag('--label', 'unlabelled')
const ONLY = flag('--only', '')

const NEON_URL = process.env.NEON_URL
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tgxxqzeaqxiwoqzopcku.supabase.co'
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
if (!NEON_URL) { console.error('Set NEON_URL first (see README.md).'); process.exit(1) }

const ms = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t }
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1] }
}
async function series(fn) {
  const first = await ms(fn) // includes TLS set-up, and waking the database if it was asleep
  const xs = []
  for (let i = 0; i < N; i++) xs.push(await ms(fn))
  return { first, ...stats(xs) }
}
// node-postgres lets sslmode in the URL override the ssl option, so strip it and set TLS here.
function pgClient(url, caPath) {
  const u = new URL(url)
  u.searchParams.delete('sslmode'); u.searchParams.delete('channel_binding')
  return new pg.Client({ connectionString: u.toString(), ssl: caPath ? { ca: fs.readFileSync(caPath, 'utf8') } : true })
}
const host = (url) => { try { return new URL(url).hostname } catch { return '?' } }

const tests = {
  'neon-http': {
    what: `Neon over HTTPS (the driver Workers use) → ${host(NEON_URL)}`,
    run: async () => { const sql = neon(NEON_URL); return series(() => sql`select 1`) },
  },
  'neon-tcp': {
    what: 'Neon over a Postgres connection (pooled)',
    run: async () => {
      const c = pgClient(NEON_URL); const connect = await ms(() => c.connect())
      try { return { connect, ...(await series(() => c.query('select 1'))) } } finally { await c.end() }
    },
  },
  'supabase-https': {
    what: `Supabase API reading one row in Mumbai (what today's browser does) → ${host(SUPABASE_URL)}`,
    skip: !SUPABASE_ANON_KEY && 'set SUPABASE_ANON_KEY to include it',
    run: async () => series(async () => {
      // site_settings is readable by anyone, so the public key is enough; the read reaches Postgres in Mumbai.
      const r = await fetch(`${SUPABASE_URL}/rest/v1/site_settings?select=key&limit=1`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Cache-Control': 'no-cache' },
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await r.arrayBuffer()
    }),
  },
  'supabase-tcp': {
    what: 'Supabase Postgres in Mumbai (session pooler)',
    skip: !SUPABASE_DB_URL && 'set SUPABASE_DB_URL to include it',
    run: async () => {
      const c = pgClient(SUPABASE_DB_URL, process.env.SUPABASE_CA); const connect = await ms(() => c.connect())
      try { return { connect, ...(await series(() => c.query('select 1'))) } } finally { await c.end() }
    },
  },
}

const f = (x) => (x === undefined ? '' : `${x.toFixed(0)} ms`).padStart(9)
console.log(`Spike S4 part A, network "${LABEL}", ${N} round trips each, ${new Date().toISOString()}\n`)
console.log(`${'test'.padEnd(15)}${'first'.padStart(9)}${'connect'.padStart(9)}${'min'.padStart(9)}${'median'.padStart(9)}${'p95'.padStart(9)}  what`)
const out = {}
for (const [name, t] of Object.entries(tests)) {
  if (ONLY && name !== ONLY) continue
  if (t.skip) { console.log(`${name.padEnd(15)}  skipped: ${t.skip}`); continue }
  try {
    const r = await t.run(); out[name] = r
    console.log(`${name.padEnd(15)}${f(r.first)}${f(r.connect)}${f(r.min)}${f(r.p50)}${f(r.p95)}  ${t.what}`)
  } catch (e) {
    console.log(`${name.padEnd(15)}  failed: ${e.message}`)
  }
}

const neonMid = out['neon-http']?.p50
const sbMid = out['supabase-tcp']?.p50 ?? out['supabase-https']?.p50
if (neonMid && sbMid) {
  const extra = neonMid - sbMid
  console.log(`\nNeon Singapore adds about ${extra.toFixed(0)} ms per round trip compared with Supabase Mumbai.`)
  console.log(`A screen making 1 call: +${extra.toFixed(0)} ms. A screen making 12 calls one after another: +${(12 * extra).toFixed(0)} ms.`)
}
const row = [new Date().toISOString(), LABEL, ...['neon-http', 'neon-tcp', 'supabase-https', 'supabase-tcp'].map((k) => out[k]?.p50?.toFixed(0) ?? '')].join(',')
fs.appendFileSync(new URL('./results.csv', import.meta.url), row + '\n')
console.log(`\nSaved to results.csv: ${row}`)
console.log('Paste the table above into the chat. It contains no passwords.')
