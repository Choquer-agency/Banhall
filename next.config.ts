import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BNH-28: bake the deploy timestamp into the bundle at build time. `next build`
  // runs on every Vercel deployment, so this refreshes automatically each publish.
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
