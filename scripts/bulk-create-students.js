/**
 * Bulk-create students in Supabase Auth (auto-confirmed) + set their profile.
 *
 * Reads a CSV or XLSX file of students and, for each one:
 *   1. Creates an auth user via the Admin API with email_confirm: true
 *      (auto-confirmed — no verification email needed).
 *   2. The DB trigger `on_auth_user_created` auto-creates the matching
 *      `profiles` row (full_name + role from metadata).
 *   3. Patches the profile with `grade` and `section`.
 *
 * It is SAFE TO RE-RUN: users that already exist are skipped (and their
 * grade/section is refreshed), so you can fix a bad row and run again.
 *
 * ------------------------------------------------------------------
 * USAGE
 *   node scripts/bulk-create-students.js data/students.csv
 *   node scripts/bulk-create-students.js data/students.xlsx
 *
 * Add --dry-run to validate the file without touching Supabase:
 *   node scripts/bulk-create-students.js data/students.csv --dry-run
 *
 * Requires these vars in .env.local (already present in this repo):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional overrides via environment:
 *   STUDENT_PASSWORD   default: "mps"
 * ------------------------------------------------------------------
 *
 * INPUT FILE FORMAT (header row required, case-insensitive). Accepted
 * column names (first match wins):
 *   name      <- "full_name", "name", "student name", "student_name"
 *   email     <- "email", "mail", "email id", "email_id", "mail id"
 *   grade     <- "grade", "class", "std", "standard"   (integer)
 *   section   <- "section", "sec", "division"          (optional)
 */

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')

// ---- tiny .env.local loader (no external dependency) --------------
function loadEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      let val = m[2]
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    /* file is optional if vars are already in the environment */
  }
}
loadEnv(path.resolve(process.cwd(), '.env.local'))

// ---- config -------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = process.env.STUDENT_PASSWORD || 'mps'
const CONCURRENCY = 5 // gentle on Supabase rate limits

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const inputFile = args.find((a) => !a.startsWith('--'))

if (!inputFile) {
  console.error('❌ Usage: node scripts/bulk-create-students.js <students.csv|xlsx> [--dry-run]')
  process.exit(1)
}
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// ---- header normalisation -----------------------------------------
const FIELD_ALIASES = {
  name: ['full_name', 'fullname', 'name', 'student name', 'student_name', 'studentname'],
  email: ['email', 'mail', 'email id', 'email_id', 'emailid', 'mail id', 'mail_id', 'e-mail'],
  grade: ['grade', 'class', 'std', 'standard'],
  section: ['section', 'sec', 'division', 'div'],
}

function resolveColumns(headerRow) {
  const lower = headerRow.map((h) => String(h || '').trim().toLowerCase())
  const map = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = lower.findIndex((h) => aliases.includes(h))
    if (idx !== -1) map[field] = idx
  }
  return map
}

function readStudents(file) {
  const wb = XLSX.readFile(file)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })
  if (!rows.length) throw new Error('File is empty')

  const cols = resolveColumns(rows[0])
  if (cols.name === undefined || cols.email === undefined) {
    throw new Error(
      `Could not find required "name" and "email" columns. Found headers: ${JSON.stringify(rows[0])}`
    )
  }

  const students = []
  const problems = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const full_name = String(r[cols.name] ?? '').trim()
    const email = String(r[cols.email] ?? '').trim().toLowerCase()
    const gradeRaw = cols.grade !== undefined ? String(r[cols.grade] ?? '').trim() : ''
    const section = cols.section !== undefined ? String(r[cols.section] ?? '').trim() : ''

    if (!full_name && !email) continue // skip fully blank rows
    if (!email || !email.includes('@')) {
      problems.push({ row: i + 1, reason: `invalid/missing email: "${email}"`, full_name })
      continue
    }
    const gradeNum = gradeRaw === '' ? null : parseInt(gradeRaw, 10)
    if (gradeRaw !== '' && Number.isNaN(gradeNum)) {
      problems.push({ row: i + 1, reason: `non-numeric grade: "${gradeRaw}"`, email })
      continue
    }
    students.push({ full_name: full_name || 'Student', email, grade: gradeNum, section: section || null })
  }
  return { students, problems }
}

// ---- duplicate-email check inside the file ------------------------
function findDuplicates(students) {
  const seen = new Map()
  const dupes = []
  for (const s of students) {
    if (seen.has(s.email)) dupes.push(s.email)
    else seen.set(s.email, true)
  }
  return [...new Set(dupes)]
}

// ---- worker -------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function processStudent(s) {
  // 1. Create the auth user (auto-confirmed).
  const { data, error } = await supabase.auth.admin.createUser({
    email: s.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: s.full_name, role: 'student' },
  })

  let userId = data?.user?.id
  let status = 'created'

  if (error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('already been registered') || msg.includes('already exists')) {
      // Idempotent: look up the existing user so we can still patch the profile.
      userId = await findUserIdByEmail(s.email)
      if (!userId) return { ...s, status: 'exists (id lookup failed)', error: error.message }
      status = 'exists (updated)'
    } else {
      return { ...s, status: 'FAILED', error: error.message }
    }
  }

  // 2. Patch grade/section onto the trigger-created profile.
  const { error: profErr } = await supabase
    .from('profiles')
    .update({ full_name: s.full_name, role: 'student', grade: s.grade, section: s.section })
    .eq('id', userId)

  if (profErr) return { ...s, status: status + ' / profile FAILED', error: profErr.message }
  return { ...s, status }
}

async function findUserIdByEmail(email) {
  // Admin API has no direct get-by-email, so page through users.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data?.users?.length) return null
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email)
    if (hit) return hit.id
    if (data.users.length < 1000) return null
  }
  return null
}

// ---- simple concurrency pool --------------------------------------
async function runPool(items, limit, fn, onResult) {
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      const res = await fn(items[i])
      onResult(res, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// ---- main ---------------------------------------------------------
async function main() {
  console.log(`📄 Reading ${inputFile} ...`)
  const { students, problems } = readStudents(inputFile)
  const dupes = findDuplicates(students)

  console.log(`   ${students.length} valid student rows`)
  if (problems.length) {
    console.log(`   ⚠️  ${problems.length} rows skipped due to problems:`)
    problems.forEach((p) => console.log(`      row ${p.row}: ${p.reason}`))
  }
  if (dupes.length) {
    console.log(`   ⚠️  ${dupes.length} duplicate email(s) in file: ${dupes.join(', ')}`)
  }
  console.log(`   Password for everyone: "${PASSWORD}"  |  email auto-confirmed: yes`)

  if (DRY_RUN) {
    console.log('\n🔎 Dry run — no users created. First 5 parsed rows:')
    console.table(students.slice(0, 5))
    return
  }
  if (!students.length) {
    console.log('Nothing to do.')
    return
  }

  console.log(`\n🚀 Creating ${students.length} students (concurrency ${CONCURRENCY})...\n`)
  const results = []
  let done = 0
  await runPool(students, CONCURRENCY, processStudent, (res) => {
    results.push(res)
    done++
    const icon = res.status.includes('FAILED') ? '❌' : res.status.startsWith('exists') ? '↺' : '✅'
    process.stdout.write(`\r   ${done}/${students.length} processed`)
    if (icon !== '✅') console.log(`\n   ${icon} ${res.email} — ${res.status}${res.error ? ': ' + res.error : ''}`)
  })

  // ---- summary + report file --------------------------------------
  const created = results.filter((r) => r.status === 'created').length
  const existed = results.filter((r) => r.status.startsWith('exists')).length
  const failed = results.filter((r) => r.status.includes('FAILED'))

  console.log(`\n\n──────── Summary ────────`)
  console.log(`✅ created:  ${created}`)
  console.log(`↺  existed:  ${existed}`)
  console.log(`❌ failed:   ${failed.length}`)

  const reportPath = path.resolve(process.cwd(), 'data', `import-report-${Date.now()}.csv`)
  const csv = [
    'email,full_name,grade,section,status,error',
    ...results.map((r) =>
      [r.email, r.full_name, r.grade ?? '', r.section ?? '', r.status, (r.error || '').replace(/[,\n]/g, ' ')]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    ),
  ].join('\n')
  fs.writeFileSync(reportPath, csv)
  console.log(`\n📝 Full report written to: ${reportPath}`)

  if (failed.length) {
    const first = failed[0].error || ''
    if (/password/i.test(first)) {
      console.log(
        `\n💡 Hint: failures look password-related. Your password "${PASSWORD}" may be shorter than\n` +
          `   Supabase's minimum. Dashboard → Authentication → Sign In/Providers → Email →\n` +
          `   "Minimum password length", set it to ${PASSWORD.length}, then re-run this script.`
      )
    }
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('\n💥 Fatal:', e.message)
  process.exit(1)
})
