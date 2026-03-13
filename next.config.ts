import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
    serverActions: {
      bodySizeLimit: "10mb" // Matches MAX_EVENT_IMAGE_BYTES in src/actions/events.ts
    }
  }
};

export default nextConfig;
