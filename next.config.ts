import type { NextConfig } from "next";
import type { Configuration } from "webpack";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['fgzerfpqyncpjpiadjqh.supabase.co'],
  },
  webpack: (config: Configuration, { dev }: { dev: boolean }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
