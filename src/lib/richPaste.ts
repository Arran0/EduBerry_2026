// ============================================================
// Formatted paste — preserves superscript/subscript on paste
//
// Exam question fields are plain <textarea>/<input> elements (plain-text
// storage, no HTML rendering downstream). Word/Google Docs represent
// superscript/subscript as a *formatting attribute* on an ordinary
// character (e.g. "2"), not as the Unicode superscript character ("²").
// The browser's default paste-into-plain-text-field behaviour flattens
// clipboard HTML to plain text, silently dropping that attribute.
//
// This reads the clipboard's HTML representation (when present) and maps
// <sup>/<sub> runs onto their Unicode superscript/subscript equivalents
// so the formatting survives as plain text — no schema or rendering
// changes required anywhere else.
// ============================================================

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ',
  'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ',
  't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
  'A': 'ᴬ', 'B': 'ᴮ', 'D': 'ᴰ', 'E': 'ᴱ', 'G': 'ᴳ', 'H': 'ᴴ', 'I': 'ᴵ', 'J': 'ᴶ', 'K': 'ᴷ',
  'L': 'ᴸ', 'M': 'ᴹ', 'N': 'ᴺ', 'O': 'ᴼ', 'P': 'ᴾ', 'R': 'ᴿ', 'T': 'ᵀ', 'U': 'ᵁ', 'V': 'ⱽ', 'W': 'ᵂ',
}

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ',
  'n': 'ₙ', 'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ', 'v': 'ᵥ', 'x': 'ₓ',
}

/** Map every character in `text` through `map`; if any character has no Unicode
 *  equivalent, fall back to wrapping the whole run in caret notation (^(..) / _(..))
 *  so the formatting is still legible instead of silently vanishing. */
function mapRun(text: string, map: Record<string, string>, wrapper: '^' | '_'): string {
  if (!text) return ''
  let mapped = ''
  for (const ch of text) {
    const m = map[ch.toLowerCase()]
    if (!m) return `${wrapper}(${text})`
    mapped += m
  }
  return mapped
}

function walk(node: Node): string {
  let out = ''
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? ''
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as HTMLElement
    const tag = el.tagName.toLowerCase()
    const inner = walk(el)
    if (tag === 'sup') out += mapRun(inner, SUPERSCRIPT_MAP, '^')
    else if (tag === 'sub') out += mapRun(inner, SUBSCRIPT_MAP, '_')
    else if (tag === 'br') out += '\n'
    else if (tag === 'p' || tag === 'div' || tag === 'li') out += `${inner}\n`
    else if (tag === 'script' || tag === 'style') { /* skip */ }
    else out += inner
  })
  return out
}

/**
 * Map a single typed character to its Unicode superscript/subscript form
 * (used while a script-toggle mode from the keyboard shortcut is active).
 * Falls back to the character itself when no Unicode equivalent exists.
 */
export function mapChar(ch: string, mode: 'sup' | 'sub'): string {
  const map = mode === 'sup' ? SUPERSCRIPT_MAP : SUBSCRIPT_MAP
  return map[ch] ?? map[ch.toLowerCase()] ?? ch
}

/** Convert clipboard HTML into plain text, translating <sup>/<sub> runs to Unicode. */
export function htmlClipboardToFormattedText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return walk(doc.body)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/**
 * Paste handler for plain-text fields: if the clipboard carries an HTML
 * representation, converts sup/sub formatting to Unicode and inserts the
 * result at the caret; otherwise lets the browser's default plain-text
 * paste proceed untouched.
 */
export function pasteFormattedText(
  e: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  applyUpdater: (updater: (prev: string) => string) => void,
  opts: { singleLine?: boolean } = {},
): void {
  const html = e.clipboardData.getData('text/html')
  if (!html) return
  let inserted = htmlClipboardToFormattedText(html)
  if (!inserted) return
  if (opts.singleLine) inserted = inserted.replace(/\s*\n+\s*/g, ' ').trim()
  e.preventDefault()

  const target = e.currentTarget
  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? target.value.length
  applyUpdater(prev => prev.slice(0, start) + inserted + prev.slice(end))

  const caret = start + inserted.length
  requestAnimationFrame(() => {
    try { target.setSelectionRange(caret, caret) } catch { /* target may have unmounted */ }
  })
}
