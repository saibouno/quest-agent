import type { NextConfig } from "next";

const buildNoProfile = process.env.QUEST_AGENT_BUILD_NOPROFILE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  experimental: {
    preloadEntriesOnStart: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  typescript: buildNoProfile
    ? {
        ignoreBuildErrors: true,
      }
    : undefined,
};

export default nextConfig;
