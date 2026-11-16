import { createFileRoute } from "@tanstack/react-router";
import { SITE_URL } from "@/lib/links";

const PAGES = ["/"];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        // Sitemap URLs must be absolute, so there is nothing valid to serve without the origin.
        if (!SITE_URL) return new Response("Not found", { status: 404 });
        const urls = PAGES.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      },
    },
  },
});
