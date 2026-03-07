import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  transpilePackages: ['@yiyi_zhang/reactflow-ui'],
  turbopack: {
    // Set root to common parent so Turbopack can follow symlinks to linked packages
    root: path.resolve(__dirname, "../../.."),
  },
};

export default nextConfig;
