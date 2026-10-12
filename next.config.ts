import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / ONNX packages must load from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["better-sqlite3", "@huggingface/transformers"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
