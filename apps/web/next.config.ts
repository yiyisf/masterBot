import type { NextConfig } from 'next';

const apiOrigin = process.env.CMASTER_API_ORIGIN ?? 'http://localhost:3100';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@cmaster/contracts'],
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
};

export default nextConfig;
