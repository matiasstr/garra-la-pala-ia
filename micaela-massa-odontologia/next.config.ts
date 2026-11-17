import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // PGlite solo se usa en tests; evitamos que el bundler lo procese.
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
