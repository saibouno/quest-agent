import type { NextConfig } from "next";

const buildNoProfile = process.env.QUEST_AGENT_BUILD_NOPROFILE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    preloadEntriesOnStart: false,
  },
  typescript: buildNoProfile
    ? {
        ignoreBuildErrors: true,
      }
    : undefined,
};

export default nextConfig;
