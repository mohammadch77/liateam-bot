import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // pg is a Node-only driver: keep it out of the bundle.
  serverExternalPackages: ['pg'],
  // The repo root has its own lockfile (sync bot); this app is its own workspace.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
