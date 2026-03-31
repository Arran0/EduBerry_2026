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

        // Override the webpack-dev-server socket path so any webpack HMR client
        // entry targets /_next/webpack-hmr instead of the root path.
        config.plugins = config.plugins ?? [];
        config.plugins.push(
          new webpack.DefinePlugin({
            __WDS_SOCKET_PATH__: JSON.stringify("/_next/webpack-hmr"),
          })
        );
      }
    }
    return config;
  },
};

export default nextConfig;
