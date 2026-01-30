import { vitePlugin as remix } from "@remix-run/dev";
import { installGlobals } from "@remix-run/node";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import basicSsl from "@vitejs/plugin-basic-ssl";

installGlobals({ nativeFetch: true });

// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the
// remix server. The CLI will eventually stop passing in HOST.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host, ".trycloudflare.com"],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      allow: ["app", "node_modules"],
    },
    // Fix for Remix adapter header issue
    middlewareMode: false,
    // Filter out HTTP/2 pseudo-headers
    proxy: {},
  },
  plugins: [
    ...(host === "localhost" ? [basicSsl()] : []),
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: false,
      },
    }),
    tsconfigPaths(),
    // Custom plugin to filter invalid HTTP/2 pseudo-headers
    {
      name: "filter-invalid-headers",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Remove HTTP/2 pseudo-headers if present
          const invalidHeaders = [":method", ":path", ":scheme", ":authority"];
          invalidHeaders.forEach((header) => {
            if (req.headers[header]) {
              delete req.headers[header];
            }
          });
          next();
        });
      },
    },
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react", "@shopify/polaris"],
  },
}) satisfies UserConfig;
