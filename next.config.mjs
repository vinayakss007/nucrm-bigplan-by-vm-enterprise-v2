import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// #177: Ensure custom .next directory exists (e.g. tmpfs for faster builds)
const distDir = process.env.NEXT_DIST_DIR || '.next';
if (distDir !== '.next' && !fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
  console.log(`[next.config] Created distDir: ${distDir}`);
}

// allowedDevOrigins — auto-detect external IP so dev server works from any network
const origins = ['localhost:3000'];
let externalIp = process.env.EXTERNAL_IP;
if (!externalIp) {
  try {
    externalIp = (await import('node:child_process')).execSync('curl -s ifconfig.me --connect-timeout 5').toString().trim();
  } catch {
    try {
      externalIp = (await import('node:child_process')).execSync('dig +short myip.opendns.com @resolver1.opendns.com -4 2>/dev/null').toString().trim();
    } catch {}
  }
}
if (externalIp) {
  origins.push(externalIp, `${externalIp}:3000`);
  console.log(`[next.config] External IP detected: ${externalIp}`);
} else {
  console.warn('[next.config] Could not detect external IP — add EXTERNAL_IP env var if needed');
}

/** @type {import('next').NextConfig} */
let nextConfig = {
  distDir,
  allowedDevOrigins: origins,
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
  poweredByHeader: false,
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
        ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
        { key: 'Content-Security-Policy', value: process.env.NODE_ENV === 'production' ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; form-action 'self'" : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; form-action 'self'" },
      ],
    }, {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' }, { key: 'CDN-Cache-Control', value: 'no-store' }],
    }, {
      source: '/api/:path*/public/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=60' }],
    }, {
      source: '/_next/static/:path*',
      headers: process.env.NODE_ENV === 'production'
        ? [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
        : [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
    }];
  },
};
if (process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN) {
  try {
    const { withSentryConfig } = await import('@sentry/nextjs');
    nextConfig = withSentryConfig(nextConfig, { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN, silent: true, widenClientFileUpload: true, hideSourceMaps: true });
  } catch (e) { console.error('[next.config] Sentry config failed:', e); }
}
// Bundle analyzer for `ANALYZE=true npm run build`
if (process.env.ANALYZE === 'true') {
  const withBundleAnalyzer = (await import('@next/bundle-analyzer')).default({
    enabled: true,
    openAnalyzer: true,
    analyzerMode: 'static',
    reportTitle: 'NuCRM Bundle Analysis',
  });
  nextConfig = withBundleAnalyzer(nextConfig);
}

export default nextConfig;
