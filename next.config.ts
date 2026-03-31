import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['fgzerfpqyncpjpiadjqh.supabase.co'],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config, { dev, isServer, webpack }: { dev: boolean; isServer: boolean; webpack: any }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };

      if (!isServer) {
        // Disable webpack lazy compilation, which opens its own WebSocket at the
        // root path (ws://localhost:PORT/) and fails in proxied/containerised envs.
        if (config.experiments) {
          config.experiments.lazyCompilation = false;
        }

        // Next.js injects LOCAL_RELOAD_SOCKET_URL via its own DefinePlugin as a
        // free variable that resolves to ws://HOST:PORT/ (root, no path).
        // In proxied/containerised envs the root-path WebSocket isn't served,
        // so we push a second DefinePlugin here — it runs after Next.js's and
        // therefore takes precedence — redirecting the connection to the actual
        // HMR endpoint at /_next/webpack-hmr.
        // __WDS_SOCKET_PATH__ is a belt-and-suspenders override for any
        // webpack-dev-server-style HMR client that may also be present.
        config.plugins = config.plugins ?? [];
        config.plugins.push(
          new webpack.DefinePlugin({
            __WDS_SOCKET_PATH__: JSON.stringify("/_next/webpack-hmr"),
            LOCAL_RELOAD_SOCKET_URL:
              "(window.location.protocol.replace('http','ws')" +
              " + '//' + window.location.host + '/_next/webpack-hmr')",
          })
        );
      }
    }
    return config;
  },
};

export default nextConfig;
