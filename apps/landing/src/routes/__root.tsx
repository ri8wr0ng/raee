import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "@/styles.css?url";
import { REPO_URL, SITE_URL, absoluteUrl } from "@/lib/links";

const NAME = "raE.E";
const TITLE = "raE.E: local-first video editor for browser and desktop";
const DESCRIPTION =
  "Record your screen, edit on a real timeline, cut by transcript and collect frame-accurate feedback. raE.E is a free, open-source video editor for the browser and Windows, and your media stays on your machine.";
const OG_IMAGE_ALT = "raE.E: from first take to final cut";

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: NAME,
      ...(SITE_URL && { url: `${SITE_URL}/` }),
    },
    {
      "@type": "SoftwareApplication",
      name: NAME,
      description: DESCRIPTION,
      applicationCategory: "MultimediaApplication",
      applicationSubCategory: "Video editor",
      operatingSystem: "Web browser, Windows",
      isAccessibleForFree: true,
      license: "https://www.gnu.org/licenses/agpl-3.0.html",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Screen, camera and microphone recording",
        "Multi-track timeline with split, trim, roll, slip and ripple edits",
        "Local transcription and transcript-based editing",
        "Filler word and pause removal",
        "WebM, H.264 MP4 and 4K HEVC export",
        "CLI, MCP server and SDK for automation",
      ],
      image: absoluteUrl("/og.png"),
      sameAs: [REPO_URL],
      ...(SITE_URL && { url: `${SITE_URL}/` }),
    },
  ],
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "application-name", content: NAME },
      { name: "robots", content: "index, follow, max-image-preview:large" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: NAME },
      { property: "og:locale", content: "en_US" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      ...(SITE_URL ? [{ property: "og:url", content: `${SITE_URL}/` }] : []),
      { property: "og:image", content: absoluteUrl("/og.png") },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: OG_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: absoluteUrl("/og.png") },
      { name: "twitter:image:alt", content: OG_IMAGE_ALT },
      { name: "theme-color", content: "#fafaf9" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      ...(SITE_URL ? [{ rel: "canonical", href: `${SITE_URL}/` }] : []),
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(structuredData) }],
  }),
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl px-6 pt-32">
      <meta name="robots" content="noindex" />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <a className="mt-4 inline-block text-brand-deep underline" href="/">
        Back to raE.E
      </a>
    </main>
  ),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
