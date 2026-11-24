import { createLandingEnv } from "@raee/env/landing";

export const env = createLandingEnv({
  VITE_EDITOR_URL: import.meta.env.VITE_EDITOR_URL,
  VITE_SITE_URL: import.meta.env.VITE_SITE_URL,
});
