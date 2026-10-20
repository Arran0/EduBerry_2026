// What the Task Manager accepts as a comment attachment.
//
// The buckets serve files from public URLs, so what goes in is what anyone
// with the link gets back. An SVG or an HTML file served from there is a page,
// not a picture — it runs script on the storage domain — so uploads are held
// to the image and office formats the pickers offer, at a sensible size.

export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']
const DOCUMENT_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip']

/** The `accept` attribute for the attachment pickers. */
export const ATTACHMENT_ACCEPT = [...IMAGE_EXTS, ...DOCUMENT_EXTS].map(e => `.${e}`).join(',')
export const IMAGE_ACCEPT = IMAGE_EXTS.map(e => `.${e}`).join(',')

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Whether a file is shown as an image (by its extension, not its claimed type). */
export function isImageAttachment(name: string): boolean {
  return IMAGE_EXTS.includes(extOf(name))
}

/** Null when the file may be uploaded; otherwise the reason it may not. */
export function attachmentProblem(file: { name: string; size: number }): string | null {
  const ext = extOf(file.name)
  if (!IMAGE_EXTS.includes(ext) && !DOCUMENT_EXTS.includes(ext)) {
    return `${file.name}: only images, PDFs, Office files, text and zip files can be attached.`
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `${file.name} is larger than 15 MB.`
  }
  return null
}

/**
 * A link someone typed, made safe to store and render: http(s) only, with a
 * bare "example.com" read as https. Anything else — `javascript:`, `data:`,
 * a mistyped scheme — is refused.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!u.hostname.includes('.')) return null
    return u.href
  } catch {
    return null
  }
}

/**
 * One CSV field. Quoted when it holds a comma, quote or line break, and a
 * leading = + - @ is defused: a spreadsheet would otherwise run a name such
 * as "=HYPERLINK(...)" as a formula when the export is opened.
 */
export function csvField(value: string | number | null | undefined): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
