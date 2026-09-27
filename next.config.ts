import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Permissions-Policy",
    // The watch page embeds a YouTube player and voice mode needs the mic.
    value: "microphone=(self), camera=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  images: {
    // Without this, next/image rejects the YouTube thumbnail host and the
    // EpisodeCard was forced to set `unoptimized`, disabling optimization.
    remotePatterns: [
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
