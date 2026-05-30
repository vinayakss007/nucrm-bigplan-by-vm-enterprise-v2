import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
let nextConfig = {
  allowedDevOrigins: ['136.119.162.223', 'localhost:3000', '4bc0-34-58-30-100.ngrok-free.app'],
  turbopack: {
    root: __dirname,
  },

  // TypeScript — ignore build errors in CI only
  typescript: {
    ignoreBuildErrors: process.env.CI === 'true',
  },

  // Build indicators
  devIndicators: {
    buildActivity: false,
  },

  // Image optimization
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

  // Compression
  compress: true,

  // Production optimizations
  productionBrowserSourceMaps: false,

  // Server external packages
  serverExternalPackages: ['pg', 'nodemailer'],

  // Transpile packages
  transpilePackages: ['@xyflow/react'],

  // Experimental features
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-*', '@dnd-kit/core', '@dnd-kit/sortable'],
  },

  // Security + Caching headers
  async headers() {
    return [
      // Security headers on ALL routes (defense-in-depth even without nginx)
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/api/:path*/public/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=60' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },

  // Bundle analysis
  webpack: (config, { isServer }) => {
    if (!isServer && process.env.ANALYZE === 'true') {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          default: false,
          vendors: false,
          // Vendor chunks for better caching
          framework: {
            chunks: 'all',
            name: 'framework',
            test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            priority: 40,
            enforce: true,
          },
          lib: {
            test: /[\\/]node_modules[\\/]/,
            chunks: 'all',
            name: 'lib',
            priority: 30,
            minSize: 50000,
            maxSize: 250000,
          },
          commons: {
            name: 'commons',
            chunks: 'all',
            minChunks: 2,
            priority: 20,
          },
          shared: {
            name: 'shared',
            chunks: 'all',
            minChunks: 3,
            priority: 10,
            reuseExistingChunk: true,
          },
        },
        maxInitialRequests: 30,
        maxAsyncRequests: 30,
        minSize: 20000,
        maxSize: 250000,
      };
    }
    return config;
  },
};

// Add Sentry if configured
if (process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN) {
  try {
    const { withSentryConfig } = await import('@sentry/nextjs');
    const sentryWebpackPluginOptions = {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      widenClientFileUpload: true,
      hideSourceMaps: true,
    };
    nextConfig = withSentryConfig(nextConfig, sentryWebpackPluginOptions);
    console.log('[next.config] Sentry enabled');
  } catch (e) {
    console.log('[next.config] Sentry not available');
  }
}

export default nextConfig;