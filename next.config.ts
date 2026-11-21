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

    return [
      {
        source: '/sw.js',
        headers: noStoreHeaders,
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
