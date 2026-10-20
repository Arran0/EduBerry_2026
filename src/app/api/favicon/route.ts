import { NextResponse } from 'next/server'
import { fetchBranding } from '@/lib/pageConfig'

// Cache the response for 60 s at the CDN/browser level. Next.js also uses
// revalidate to avoid hitting the DB on every request.
export const revalidate = 60

// Branding images are uploaded to our own Supabase Storage. Fetching anything
// else would let whoever can edit site_settings make this server request any
// URL (internal addresses included), and the upstream content-type is written
// into the SVG markup below, so it must be a plain image type.
const ALLOWED_MIME = /^image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|svg\+xml)$/
const MAX_BYTES = 1024 * 1024

function isOwnStorageUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    return url.protocol === 'https:' && url.host === storage.host
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  const branding = await fetchBranding()
  const imageUrl = branding.faviconUrl || branding.logoUrl
  const fallback = () => NextResponse.redirect(new URL('/favicon.ico', request.url), { status: 302 })

  if (!imageUrl || !isOwnStorageUrl(imageUrl)) {
    // No custom icon configured (or not one of ours) — the static default
    return fallback()
  }

  // Fetch the source image server-side so we can embed it directly in the
  // SVG. Embedding as a base64 data-URL avoids any cross-origin issues that
  // would occur if the SVG referenced the Supabase URL externally.
  const imgRes = await fetch(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => null)
  const mime = (imgRes?.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!imgRes?.ok || !ALLOWED_MIME.test(mime)) return fallback()
  const buf = await imgRes.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) return fallback()
  const b64 = Buffer.from(buf).toString('base64')
  const dataUrl = `data:${mime};base64,${b64}`

  // SVG circular crop: clipPath with a full-radius circle masks the image.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">
  <defs>
    <clipPath id="c"><circle cx="16" cy="16" r="16"/></clipPath>
  </defs>
  <image href="${dataUrl}" width="32" height="32" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>
</svg>`

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}
