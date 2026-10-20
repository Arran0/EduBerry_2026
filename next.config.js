const { DefinePlugin } = require('webpack')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    domains: ['tgxxqzeaqxiwoqzopcku.supabase.co'],
  },
  experimental: {},
  async headers() {
    return [
      {
        // Blanket no-store for pages/API/RSC payloads — this app is
        // session-driven throughout, so dynamic responses must never be
        // served stale after sign-out/account-switch.
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store',
          },
          // Basic browser hardening: no MIME sniffing, no framing by other
          // sites (clickjacking), and no full URLs leaked to other origins.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HTTPS only from here on, for a year.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // The directives that cannot break a page: no plugins, no <base>
          // hijack, forms only post back here, framing as X-Frame-Options.
          // script-src is deliberately absent — App Router's inline bootstrap
          // scripts need a per-request nonce (middleware) before it can be set.
          {
            key: 'Content-Security-Policy',
            value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
          },
          // Camera for QR scanning, GPS for check-in / bus tracking; no mic.
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(self "https://checkout.razorpay.com"), usb=()' },
        ],
      },
      {
        // Next.js content-hashes every file under _next/static by build
        // output, so any change produces a new filename — caching forever
        // is 100% safe and is Next's own default. The blanket rule above
        // was overriding that default, forcing a full bundle re-download on
        // every cold navigation. Headers matching the same key on an
        // overlapping route: the later, more specific entry wins.
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Static branding/icon assets in public/ (not content-hashed, so a
        // long max-age risks serving a stale logo after a rebrand — use a
        // short cache with revalidation instead of a full year).
        source: '/:file(apple-touch-icon\\.png|favicon-16\\.png|favicon-32\\.png|favicon\\.ico|favicon\\.png|logo\\.png|manifest\\.json|file\\.svg|globe\\.svg|next\\.svg|vercel\\.svg|window\\.svg)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ]
  },
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      }

      if (!isServer) {
        // Disable lazy compilation which opens its own WebSocket at the root
        // path (ws://localhost:PORT/) and fails in proxied/containerised envs.
        if (config.experiments) {
          config.experiments.lazyCompilation = false
        }

        // Next.js injects LOCAL_RELOAD_SOCKET_URL as ws://HOST:PORT/ (root path).
        // In proxied/containerised envs the root-path WebSocket isn't reliably
        // available, causing failures in second tabs and after navigation.
        // Override to use the actual HMR endpoint at /_next/webpack-hmr.
        config.plugins = config.plugins ?? []
        config.plugins.push(
          new DefinePlugin({
            __WDS_SOCKET_PATH__: JSON.stringify('/_next/webpack-hmr'),
            LOCAL_RELOAD_SOCKET_URL:
              "(window.location.protocol.replace('http','ws')" +
              " + '//' + window.location.host + '/_next/webpack-hmr')",
          })
        )
      }
    }
    return config
  },
}

module.exports = nextConfig
