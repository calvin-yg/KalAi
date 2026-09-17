import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle, so the Docker image doesn't ship node_modules.
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
