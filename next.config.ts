import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    preloadEntriesOnStart: false,
  },
};

export default nextConfig;
