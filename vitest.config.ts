/**
 * Vitest Configuration
 *
 * Test configuration for the Shopify Inventory Sync App
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "build/",
        "dist/",
        "**/*.d.ts",
        "**/*.config.ts",
        "**/types.ts",
      ],
    },
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "build", "dist"],
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
});
