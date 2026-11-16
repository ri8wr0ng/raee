import { env } from "../env";

export const REPO_URL = "https://github.com/sharull9/SideCut";
export const EDITOR_URL: string = env.VITE_EDITOR_URL ?? REPO_URL;

/** Public origin without a trailing slash, or undefined when the deployment URL is unknown. */
export const SITE_URL: string | undefined = env.VITE_SITE_URL?.replace(/\/+$/, "");

/** Resolve a root-relative path against SITE_URL; stays relative when SITE_URL is unknown. */
export function absoluteUrl(path: string): string {
  return SITE_URL ? `${SITE_URL}${path}` : path;
}
