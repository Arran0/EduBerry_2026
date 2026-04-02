import { NextResponse } from 'next/server'
import { fetchBranding } from '@/lib/pageConfig'

// Cache the response for 60 s at the CDN/browser level. Next.js also uses
// revalidate to avoid hitting the DB on every request.
export const revalidate = 60

export async function GET(request: Request) {
  const branding = await fetchBranding()
  const imageUrl = branding.faviconUrl || branding.logoUrl

  if (!imageUrl) {
    // No custom icon configured — fall back to the static default
    return NextResponse.redirect(new URL('/favicon.ico', request.url), { status: 302 })
  }

  // Fetch the source image server-side so we can embed it directly in the
  // SVG. Embedding as a base64 data-URL avoids any cross-origin issues that
  // would occur if the SVG referenced the Supabase URL externally.
  const imgRes = await fetch(imageUrl)
  const buf = await imgRes.arrayBuffer()
  const mime = imgRes.headers.get('content-type') || 'image/png'
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
