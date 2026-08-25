/**
 * Client-side image resize + re-encode before upload, to cut both Supabase
 * Storage usage and every subsequent egress of the file (nothing in this
 * app compressed images before this — raw camera photos, often 3-8 MB, went
 * straight to storage and were then re-downloaded at full size into avatar-
 * and thumbnail-sized boxes everywhere they're displayed).
 *
 * Downscales to at most MAX_DIMENSION px on the long edge and re-encodes.
 * Non-image files, animated/vector formats canvas can't safely re-encode,
 * already-small images, or any decode/encode failure all fall back to the
 * original File unchanged — compression must never block an upload.
 */

const MAX_DIMENSION = 1600
const QUALITY = 0.82
// Below this, a full-resolution image is already small enough that
// re-encoding risks making it *larger* (re-compression artifacts) for no
// real benefit.
const SKIP_IF_UNDER_BYTES = 400 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  // Animated GIFs would lose their animation if drawn to a canvas; SVGs are
  // already tiny vector text. Leave both untouched.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))

    if (scale === 1 && file.size < SKIP_IF_UNDER_BYTES) {
      return file
    }

    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    ctx.drawImage(bitmap, 0, 0, targetW, targetH)

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/webp', QUALITY)
    })
    if (!blob) return file

    // Some browsers (notably Safari, historically) silently fall back to
    // PNG when asked to encode WebP. `blob.type` always reflects what was
    // actually produced, so derive the extension from that rather than
    // assuming the request was honoured.
    if (blob.size >= file.size) return file

    const ext = EXT_BY_MIME[blob.type] ?? file.name.split('.').pop() ?? 'bin'
    const baseName = file.name.replace(/\.[^./]+$/, '')
    return new File([blob], `${baseName}.${ext}`, {
      type: blob.type || file.type,
      lastModified: Date.now(),
    })
  } catch {
    // Decoding can fail outright (HEIC on a browser with no native codec,
    // corrupt file, memory pressure) — never block the upload on it.
    return file
  } finally {
    bitmap?.close?.()
  }
}
