import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true, // fix types iteratively post-MVP
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
