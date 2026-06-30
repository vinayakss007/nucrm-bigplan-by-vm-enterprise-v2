import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
let nextConfig = {
  allowedDevOrigins: ['localhost:3000', '34.58.9.237', '34.123.152.161'],
  typescript: { ignoreBuildErrors: false },
  devIndicators: { buildActivity: false },
  cacheMaxMemorySize: 50 * 1024 * 1024,
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-*', '@dnd-kit/core', '@dnd-kit/sortable'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.gravatar.com' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '*.s3.amazonaws.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  compress: true,
  productionBrowserSourceMaps: false,
  serverExternalPackages: ['pg', 'pg-boss', 'nodemailer'],
  transpilePackages: ['@xyflow/react'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'X-DNS-Prefetch-Control', value: 'on' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; form-action 'self'" },
      ],
    }, {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' }, { key: 'CDN-Cache-Control', value: 'no-store' }],
    }, {
      source: '/api/:path*/public/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=60' }],
    }, {
      source: '/_next/static/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    }];
  },
};
if (process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN) {
  try {
    const { withSentryConfig } = await import('@sentry/nextjs');
    nextConfig = withSentryConfig(nextConfig, { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN, silent: true, widenClientFileUpload: true, hideSourceMaps: true });
  } catch (e) { console.error('[next.config] Sentry config failed:', e); }
}
export default nextConfig;
