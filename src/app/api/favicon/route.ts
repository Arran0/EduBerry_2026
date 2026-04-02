import { NextResponse } from 'next/server'
import { fetchBranding } from '@/lib/pageConfig'

// Cache for 60 seconds so the DB isn't queried on every page load, but a
// newly uploaded favicon becomes visible within a minute.
export const revalidate = 60

export async function GET(request: Request) {
  const branding = await fetchBranding()
  const customUrl = branding.faviconUrl || branding.logoUrl
  if (customUrl) {
    return NextResponse.redirect(customUrl, {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    })
  }
  // No custom favicon — fall back to the static default
  return NextResponse.redirect(new URL('/favicon.ico', request.url), { status: 302 })
}
