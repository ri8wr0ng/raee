import { defineConfig, lazyPlugins } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { loadEnv } from "vite";

// Canonical URLs, social cards and the sitemap need the public origin. Fall back to the
// production domain Vercel exposes at build time when VITE_SITE_URL isn't set.
const fileEnv = loadEnv(process.env.NODE_ENV ?? "production", import.meta.dirname, "VITE_");
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const siteUrl =
  process.env.VITE_SITE_URL || fileEnv.VITE_SITE_URL || (vercelUrl && `https://${vercelUrl}`);
if (siteUrl) process.env.VITE_SITE_URL = siteUrl;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Prerender requests must use the same loopback address as the preview server.
  preview: { host: "127.0.0.1" },
  plugins:
    lazyPlugins(() => [
      tailwindcss(),
      tanstackStart({
        prerender: { enabled: true, crawlLinks: true },
        pages: [
          { path: "/robots.txt" },
          ...(process.env.VITE_SITE_URL ? [{ path: "/sitemap.xml" }] : []),
        ],
      }),
      nitro(),
      viteReact(),
    ]) ?? [],
});
