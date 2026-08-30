// ============================================================================
// Formula evaluation for salary components.
// ----------------------------------------------------------------------------
// A recursive-descent parser over a deliberately tiny grammar. This exists
// instead of `eval` or `new Function` for the obvious reason — formulas are
// authored by school admins in a web form and stored in the database, so
// anything that can reach a JS runtime is a remote code execution hole in a
// system that also holds bank account numbers.
//
// Grammar:
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := '-'? primary
//   primary := number | identifier | call | '(' expr ')'
//   call    := name '(' expr (',' expr)* ')'
//
// Identifiers resolve against a scope of component codes plus the pseudo-codes
// GROSS, CTC, ANCHOR and PAYABLE_DAYS. An unknown identifier is an error, never
// a silent zero: a typo in "BASIC" must not quietly halve someone's salary.
// ============================================================================

export class FormulaError extends Error {
  constructor(message: string, readonly formula: string) {
    super(`${message} (in "${formula}")`)
    this.name = 'FormulaError'
  }
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  min: a => Math.min(...a),
  max: a => Math.max(...a),
  round: a => Math.round(a[0]),
  floor: a => Math.floor(a[0]),
  ceil: a => Math.ceil(a[0]),
  abs: a => Math.abs(a[0]),
  // `pct(x, 12)` reads better in a form than `x * 12 / 100` and avoids the
  // commonest authoring mistake — writing 0.12 where 12 was meant, or vice versa.
  pct: a => (a[0] * a[1]) / 100,
}

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue }
    if (c >= '0' && c <= '9') {
      let j = i
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++
      const v = Number(src.slice(i, j))
      if (!Number.isFinite(v)) throw new FormulaError(`Bad number "${src.slice(i, j)}"`, src)
      out.push({ t: 'num', v })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      out.push({ t: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    if ('+-*/(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue }
    throw new FormulaError(`Unexpected character "${c}"`, src)
  }
  return out
}

/** Every identifier a formula references. Used to build the dependency graph before any evaluation happens. */
export function formulaDependencies(formula: string): string[] {
  const seen = new Set<string>()
  for (const tok of tokenize(formula)) {
    if (tok.t === 'id' && !(tok.v.toLowerCase() in FUNCTIONS)) seen.add(tok.v)
  }
  return [...seen]
}

export function evaluateFormula(formula: string, scope: Record<string, number>): number {
  const tokens = tokenize(formula)
  let pos = 0

  const peek = (): Token | undefined => tokens[pos]
  const eat = (v: string): boolean => {
    const t = tokens[pos]
    if (t && t.t === 'op' && t.v === v) { pos++; return true }
    return false
  }
  const expect = (v: string) => {
    if (!eat(v)) throw new FormulaError(`Expected "${v}"`, formula)
  }

  function parseExpr(): number {
    let left = parseTerm()
    for (;;) {
      if (eat('+')) left += parseTerm()
      else if (eat('-')) left -= parseTerm()
      else return left
    }
  }

  function parseTerm(): number {
    let left = parseUnary()
    for (;;) {
      if (eat('*')) left *= parseUnary()
      else if (eat('/')) {
        const d = parseUnary()
        // A structure that divides by a head which happens to be zero this month
        // should produce zero, not NaN silently poisoning every downstream head.
        left = d === 0 ? 0 : left / d
      } else return left
    }
  }

  function parseUnary(): number {
    if (eat('-')) return -parseUnary()
    if (eat('+')) return parseUnary()
    return parsePrimary()
  }

  function parsePrimary(): number {
    const t = peek()
    if (!t) throw new FormulaError('Unexpected end of formula', formula)
    if (t.t === 'num') { pos++; return t.v }
    if (t.t === 'op' && t.v === '(') { pos++; const v = parseExpr(); expect(')'); return v }
    if (t.t === 'id') {
      pos++
      const fn = FUNCTIONS[t.v.toLowerCase()]
      if (fn && peek() && peek()!.t === 'op' && (peek() as { v: string }).v === '(') {
        pos++
        const args: number[] = []
        if (!eat(')')) {
          do { args.push(parseExpr()) } while (eat(','))
          expect(')')
        }
        if (args.length === 0) throw new FormulaError(`${t.v}() needs at least one argument`, formula)
        return fn(args)
      }
      if (!(t.v in scope)) {
        throw new FormulaError(
          `Unknown component "${t.v}" — check the code exists and is evaluated before this head`,
          formula,
        )
      }
      return scope[t.v]
    }
    throw new FormulaError(`Unexpected "${t.v}"`, formula)
  }

  const result = parseExpr()
  if (pos !== tokens.length) throw new FormulaError('Trailing input after the expression', formula)
  if (!Number.isFinite(result)) throw new FormulaError('Formula did not produce a finite number', formula)
  return result
}
