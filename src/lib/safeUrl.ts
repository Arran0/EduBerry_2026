/**
 * Links in classrooms come from people: a student's submitted link, a
 * teacher's attachment, a discussion post. React 18 renders whatever string it
 * is given as an href, so `javascript:…` pasted as a "link" runs in the
 * viewer's session the moment someone clicks it — a teacher opening a
 * student's submission, say.
 *
 * Only web, mail and phone links, and paths on this site, are let through.
 * Anything else becomes undefined, which renders a link that goes nowhere.
 */
const ALLOWED = new Set(['http:', 'https:', 'mailto:', 'tel:', 'blob:'])

export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const url = raw.trim()
  if (!url) return undefined
  // Relative to this site ("/classrooms/…", "#top"), but not "//evil.com".
  if ((url.startsWith('/') && !url.startsWith('//')) || url.startsWith('#')) return url
  try {
    const parsed = new URL(url)
    return ALLOWED.has(parsed.protocol) ? parsed.href : undefined
  } catch {
    // A bare "example.com/page" typed without a scheme.
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(url)) return `https://${url}`
    return undefined
  }
}

/** For <img src> / <iframe src>: web addresses and blobs only. */
export function safeSrc(raw: string | null | undefined): string | undefined {
  const href = safeHref(raw)
  if (!href) return undefined
  return /^(https?:|blob:|\/(?!\/))/i.test(href) ? href : undefined
}
