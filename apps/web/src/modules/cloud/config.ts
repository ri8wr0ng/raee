import { env as browserEnv } from "../../env";
import { nativeBridge } from "../workspace/host-coordinator";

/** True in the desktop app when its main process can sign in to the cloud. */
export function desktopCloudAuth(): boolean {
  return window.location.protocol === "sidecut:" && Boolean(nativeBridge()?.cloudAuthSignIn);
}

export function cloudConfig(
  env: {
    url?: string | undefined;
    clientId?: string | undefined;
    apiHostname?: string | undefined;
    devMode?: string | undefined;
    redirectUri?: string | undefined;
  },
  origin: string,
  desktop = false,
) {
  if (!env.url || !env.clientId) return null;
  if (!desktop && !origin.startsWith("http")) return null;
  const url = new URL(env.url);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  )
    return null;
  // The desktop app signs in through its main process (system browser + loopback redirect), so
  // AuthKit's browser settings below do not apply there.
  if (desktop)
    return {
      url: url.origin,
      clientId: env.clientId,
      apiHostname: env.apiHostname,
      devMode: false,
      redirectUri: "",
      desktop: true as const,
    };
  const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
  if (!local && !env.apiHostname) return null;
  return {
    // Not href: its trailing slash makes Convex connect to //api/…, which never opens.
    url: url.origin,
    clientId: env.clientId,
    apiHostname: env.apiHostname,
    devMode: local && env.devMode === "true",
    // The registered WorkOS Redirect URI wins; it must route to a page that mounts AuthKitProvider.
    redirectUri: env.redirectUri || `${origin}/team`,
    desktop: false as const,
  };
}

export function browserCloudConfig() {
  try {
    return cloudConfig(
      {
        url: browserEnv.VITE_CONVEX_URL,
        clientId: browserEnv.VITE_WORKOS_CLIENT_ID,
        apiHostname: browserEnv.VITE_WORKOS_API_HOSTNAME,
        devMode: browserEnv.VITE_WORKOS_DEV_MODE,
        redirectUri: browserEnv.VITE_WORKOS_REDIRECT_URI,
      },
      window.location.origin,
      desktopCloudAuth(),
    );
  } catch {
    return null;
  }
}
