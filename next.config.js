const { DefinePlugin } = require('webpack')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['fgzerfpqyncpjpiadjqh.supabase.co'],
  },
  experimental: {
    // The App Router keeps visited page segments in a client-side "Router
    // Cache" that is separate from (and unaffected by) Cache-Control HTTP
    // headers.  Without this setting, navigating back to a page can serve a
    // stale in-memory snapshot that only a hard refresh (Shift+Cmd+R) clears.
    // Setting dynamic to 0 makes every client-side navigation fetch a fresh
    // copy from the server, eliminating the need to hard-refresh to see
    // up-to-date data.
    staleTimes: {
      dynamic: 0,
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store',
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
