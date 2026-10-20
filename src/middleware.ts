import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Per-request script nonce for a Content-Security-Policy that actually blocks
// injected scripts. Sessions live in localStorage (src/lib/supabase.ts), so
// one successful XSS is a full account takeover; this is the backstop.
//
// Next.js reads the nonce from the request's CSP header and stamps it on its
// own bootstrap and chunk scripts, which is why the root layout must render
// dynamically (it awaits headers()). 'strict-dynamic' then trusts whatever
// those scripts load — chunks, and Razorpay's checkout.js, which PayFeeModal
// injects.
//
// A header set here replaces the one next.config.js would add, so this carries
// the static directives too; next.config.js still covers what the matcher
// skips (API routes, assets).

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const dev = process.env.NODE_ENV !== 'production'

  const csp = [
    // 'wasm-unsafe-eval': react-pdf's layout engine (Yoga) is WebAssembly. It
    // permits compiling WASM only — JS eval stays blocked. React's dev build
    // additionally evaluates strings for stack traces and HMR.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    // Service worker (public/sw.js) and blob workers.
    "worker-src 'self' blob:",
    // Same as next.config.js.
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    {
      // Pages only: API routes return JSON, and static assets carry no scripts.
      source: '/((?!api|_next/static|_next/image|favicon|apple-touch-icon|sw\\.js|manifest\\.json|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)',
      // Router prefetches are not rendered as documents.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
