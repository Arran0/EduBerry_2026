#!/usr/bin/env node
// Fail if a Supabase service-role key is committed.
//
// Supabase keys are JWTs, and generic secret scanners (TruffleHog, gitleaks'
// default rules) don't tell the public anon key from the service-role key that
// bypasses every RLS policy — one was committed in .env.local and none of them
// noticed. This decodes every JWT in the tracked files and fails on any whose
// payload says `"role": "service_role"`. The anon key is meant to be public
// and passes.
//
// Usage: node scripts/check-supabase-keys.mjs   (run from the repo root)

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(f => f && !f.endsWith('package-lock.json'))

const hits = []
for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // deleted in the working tree, or unreadable
  }
  if (!text.includes('eyJ')) continue

  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const match of line.matchAll(JWT)) {
      try {
        const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
        if (payload.role === 'service_role') hits.push(`${file}:${i + 1} (project ${payload.ref ?? 'unknown'})`)
      } catch {
        // Not a JSON payload — not a Supabase key.
      }
    }
  })
}

if (hits.length) {
  console.error('Supabase service-role key committed — it bypasses all RLS. Rotate it and remove it:')
  for (const h of hits) console.error(`  ${h}`)
  process.exit(1)
}
console.log(`No Supabase service-role keys in ${files.length} tracked files.`)
