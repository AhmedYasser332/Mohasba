import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  async headers() {
    const noStoreHeaders = [
      {
        key: 'Cache-Control',
        value: 'no-store, no-cache, must-revalidate',
      },
    ];

    const pwaSecurityHeaders = [
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
    ];

    return [
      {
        source: '/(.*)',
        headers: pwaSecurityHeaders,
      },
      {
        source: '/sw.js',
        headers: [
          ...noStoreHeaders,
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: '/sw-manifest.json',
        headers: noStoreHeaders,
      },
      {
        source: '/manifest.webmanifest',
        headers: noStoreHeaders,
      },
    ];
  },
};

export default nextConfig;
