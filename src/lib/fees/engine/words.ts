// ─────────────────────────────────────────────────────────────────────────────
// Amount in words, Indian numbering.
//
// Every printed invoice and receipt in India carries the amount spelled out —
// it is what makes a figure hard to alter after the fact, and auditors look for
// it. The grouping is lakh/crore, not million/billion: ₹12,34,567 is "twelve
// lakh thirty four thousand five hundred sixty seven", and a Western
// implementation gets this wrong in a way that looks obviously foreign on a
// school receipt.
// ─────────────────────────────────────────────────────────────────────────────

import { type Paise, toRupees } from './money'

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
]

/** 0–99. */
function underHundred(n: number): string {
  if (n < 20) return ONES[n]
  const t = TENS[Math.floor(n / 10)]
  const o = ONES[n % 10]
  return o ? `${t} ${o}` : t
}

/** 0–999. */
function underThousand(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h === 0) return underHundred(rest)
  const head = `${ONES[h]} hundred`
  return rest ? `${head} ${underHundred(rest)}` : head
}

/**
 * A whole number in Indian words. Handles up to 99,99,99,999 (99 crore), which
 * is several orders of magnitude past any school's annual fee.
 */
export function numberToIndianWords(value: number): string {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'zero'

  const crore    = Math.floor(n / 10000000)
  const lakh     = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const rest     = n % 1000

  const parts: string[] = []
  if (crore)    parts.push(`${numberToIndianWords(crore)} crore`)
  if (lakh)     parts.push(`${underThousand(lakh)} lakh`)
  if (thousand) parts.push(`${underThousand(thousand)} thousand`)
  if (rest)     parts.push(underThousand(rest))

  const words = parts.join(' ')
  return value < 0 ? `minus ${words}` : words
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The line that goes on a bill: "Rupees Twenty Seven Thousand Only".
 *
 * Paise are named separately when present, as Indian invoices do, rather than
 * being folded into a decimal the words then have to explain.
 */
export function amountInWords(paise: Paise): string {
  const negative = paise < 0
  const abs = Math.abs(Math.round(paise))
  const rupees = Math.floor(abs / 100)
  const paisePart = abs % 100

  const rupeeWords = titleCase(numberToIndianWords(rupees))
    .replace(/\b\w/g, c => c.toUpperCase())

  let out = `Rupees ${rupeeWords}`
  if (paisePart > 0) {
    const paiseWords = numberToIndianWords(paisePart).replace(/\b\w/g, c => c.toUpperCase())
    out += ` and ${paiseWords} Paise`
  }
  out += ' Only'
  return negative ? `Minus ${out}` : out
}

/** Convenience for callers holding rupees rather than paise. */
export function rupeesInWords(rupees: number): string {
  return amountInWords(Math.round(rupees * 100))
}

export { toRupees }
