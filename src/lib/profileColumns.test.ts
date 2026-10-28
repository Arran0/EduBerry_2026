import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * profiles.email is not readable by signed-in users
 * (fix_profile_email_visibility_b.sql), so any browser query that names it —
 * or `*` — on profiles is refused by the database and the screen breaks. These
 * checks find such queries in the source before a user does. See
 * src/lib/profileColumns.ts for the ways to read and search addresses.
 *
 * API routes are left out: they read with the service role, which keeps the column.
 */

const ROOT = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (path === join(ROOT, 'app', 'api')) continue
      out.push(...sourceFiles(path))
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** String constants defined in a file, so `select(COLS)` and `${COLS}` can be read. */
function constants(src: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*((?:'[^']*'|`[^`]*`|"[^"]*")(?:\s*\+\s*(?:'[^']*'|`[^`]*`|"[^"]*"))*)/g
  for (const m of src.matchAll(re)) {
    const parts = [...m[2].matchAll(/'([^']*)'|`([^`]*)`|"([^"]*)"/g)].map(p => p[1] ?? p[2] ?? p[3] ?? '')
    map.set(m[1], parts.join(''))
  }
  return map
}

/** Expand `${NAME}` and bare identifiers through the file's constants. */
function resolve(text: string, consts: Map<string, string>): string {
  let out = text
  for (let i = 0; i < 3; i++) {
    out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) =>
      n === 'PROFILE_EMAIL' || n === 'PROFILE_COLUMNS' ? '' : (consts.get(n) ?? `<${n}>`))
  }
  return out
}

/** A select list that would read the hidden column. */
function readsEmail(list: string): boolean {
  const cleaned = list.replace(/(\.\.\.)?(\w+:)?profile_emails(!\w+)?\([^)]*\)/g, '')
  return /\*/.test(cleaned) || /(^|[\s,(:])email(\s*[,)]|\s*$)/.test(cleaned)
}

interface Problem { where: string; what: string }

function scan(): Problem[] {
  const problems: Problem[] = []
  for (const file of sourceFiles(ROOT)) {
    // profileColumns.ts describes these queries in its comments; it runs none.
    if (file.endsWith(join('lib', 'profileColumns.ts'))) continue
    const src = readFileSync(file, 'utf8')

    // fetchProfilesByIds(ids, columns) selects the columns it is given.
    for (const m of src.matchAll(/fetchProfilesByIds\([^,()]*(?:\([^()]*\))?[^,()]*,\s*('[^']*'|`[^`]*`)/g)) {
      if (readsEmail(resolve(m[1].slice(1, -1), constants(src)))) {
        problems.push({ where: `${relative(ROOT, file)}:${src.slice(0, m.index!).split('\n').length}`, what: `fetchProfilesByIds(…, ${m[1]})` })
      }
    }
    if (!src.includes('profiles')) continue
    const consts = constants(src)
    const at = (index: number) => `${relative(ROOT, file)}:${src.slice(0, index).split('\n').length}`

    // Direct queries: from('profiles') … up to the next query or statement.
    for (const m of src.matchAll(/from\(\s*['"`]profiles['"`]\s*\)/g)) {
      const rest = src.slice(m.index! + m[0].length)
      const stop = rest.search(/\bfrom\(|\n\s*\n|\n\s*(const|let|return|if|for)\b/)
      const chain = stop === -1 ? rest : rest.slice(0, stop)
      const sel = chain.match(/\.select\(\s*('[^']*'|`[^`]*`|"[^"]*"|[A-Za-z_][A-Za-z0-9_]*)?/)
      if (sel) {
        const arg = (sel[1] ?? '').trim()
        let list = arg
        if (/^['"`]/.test(arg)) list = resolve(arg.slice(1, -1), consts)
        else if (arg === '') list = '*'
        else if (arg === 'PROFILE_COLUMNS') list = ''
        // fetchProfilesByIds' own column list: its callers are checked above.
        else if (arg === 'columns' && src.includes('columns: string = PROFILE_COLUMNS')) list = ''
        else list = consts.get(arg) ?? `<unresolved ${arg}>`
        if (readsEmail(list) || list.startsWith('<unresolved')) problems.push({ where: at(m.index!), what: `select(${arg})` })
      }
      const filter = chain.match(/\.(eq|neq|ilike|like|in|order|is)\(\s*['"`]email['"`]|\.or\([^)]*\bemail\./)
      if (filter) problems.push({ where: at(m.index!), what: `filters on email: ${filter[0]}` })
    }

    // Embedded profiles: alias:profiles!fk(cols) or profiles(cols).
    for (const m of src.matchAll(/(?<![\w_])profiles(![A-Za-z0-9_]+)?\s*\(([^()]*)\)/g)) {
      const list = resolve(m[2], consts)
      if (readsEmail(list)) problems.push({ where: at(m.index!), what: m[0].replace(/\s+/g, ' ').slice(0, 120) })
    }
  }
  return problems
}

describe('browser queries on profiles', () => {
  it('never read or filter on profiles.email directly', () => {
    expect(scan()).toEqual([])
  })
})

describe('readsEmail', () => {
  it('flags the hidden column and star', () => {
    expect(readsEmail('id, email, full_name')).toBe(true)
    expect(readsEmail('*')).toBe(true)
    expect(readsEmail('id,email')).toBe(true)
    expect(readsEmail('id, full_name')).toBe(false)
    expect(readsEmail('id, ...profile_emails(email)')).toBe(false)
    expect(readsEmail('id, mail:profile_emails(email)')).toBe(false)
  })
})
