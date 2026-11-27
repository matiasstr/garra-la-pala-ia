import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // PGlite (base embebida de desarrollo y tests) no pasa por el bundler.
  serverExternalPackages: ['@electric-sql/pglite'],
  experimental: {
    // Con `proxy.ts`, Next guarda en memoria el cuerpo del pedido hasta este
    // límite (10 MB por defecto). Los adjuntos clínicos llegan a 10 MB: con
    // margen para que un PDF grande no llegue cortado.
    proxyClientMaxBodySize: '11mb',
  },
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
