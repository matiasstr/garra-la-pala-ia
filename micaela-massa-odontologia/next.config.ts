import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // PGlite solo se usa en tests; evitamos que el bundler lo procese.
  serverExternalPackages: ['@electric-sql/pglite'],
  // Las migraciones se leen del disco al conectar (modo desarrollo y demo
  // online): tienen que viajar con las funciones de Vercel. Alcanza con el SQL
  // y el índice; las fotos del esquema (`meta/*_snapshot.json`) solo las usa drizzle-kit.
  outputFileTracingIncludes: {
    '/*': ['./drizzle/*.sql', './drizzle/meta/_journal.json'],
  },
  outputFileTracingExcludes: {
    '/*': ['./drizzle/meta/*_snapshot.json'],
  },
};

export default nextConfig;
