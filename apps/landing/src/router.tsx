import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

// Enables the `server` option on file routes (robots.txt, sitemap.xml). The Start Vite plugin
// writes this into routeTree.gen.ts too, but the standalone `tsr generate` in typecheck does not.
declare module "@tanstack/react-start" {
  interface Register {
    ssr: true;
    router: ReturnType<typeof getRouter>;
  }
}
