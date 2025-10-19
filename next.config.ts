import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"]
  },
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
