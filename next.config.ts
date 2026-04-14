import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
    serverActions: {
      bodySizeLimit: "10mb" // Matches MAX_EVENT_IMAGE_BYTES in src/actions/events.ts
    }
  },
  async headers() {
    return [
      {
        // Security headers for API routes — middleware matcher excludes /api/* because
        // API routes use bearer-token auth (not cookie sessions). CSP is intentionally
        // omitted here since API responses are JSON, not HTML.
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
