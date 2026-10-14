import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // pg is a Node-only driver: keep it out of the bundle.
  serverExternalPackages: ['pg'],
  // The repo root has its own lockfile (sync bot); this app is its own workspace.
  turbopack: { root: process.cwd() },
  // Do not let `next dev` write an AGENTS.md into the repo.
  agentRules: false,
  // forbidden() → real HTTP 403 from role guards (src/server/auth/guards.ts).
  experimental: {
    authInterrupts: true,
    // Supplier PNGs are 0.8–6 MB; the default 7 s is too short for the first (uncached) fetch.
    imgOptTimeoutInSeconds: 30,
  },
  // Supplier pictures go through our own optimiser (/_next/image): fetched once by the server, resized to
  // WebP and cached. Visitors never load them from the supplier (no hotlinking, supplier domain not exposed).
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 's3.liateam.ir', pathname: '/**' }],
    formats: ['image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 7,
    // Few sizes on purpose: every size is a separate fetch + cache entry (see scripts/warm-images.mjs).
    deviceSizes: [390, 640, 828, 1080],
    imageSizes: [96, 160, 240, 320],
  },
};

export default nextConfig;
