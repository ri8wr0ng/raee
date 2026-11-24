import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CloudAuthState } from "@raee/contracts/desktop";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { useRouter } from "@tanstack/react-router";
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";
import type { browserCloudConfig } from "./config";
import { CloudContext, type CloudState } from "./cloud-context";
import {
  readActiveTeamId,
  returnToFromState,
  safeReturnTo,
  writeActiveTeamId,
} from "./cloud-helpers";
import { markCloudUsed } from "./cloud-activation";
import { CloudAuthContext, useCloudAuth, type CloudAuth } from "./cloud-auth";
import { nativeBridge } from "../workspace/host-coordinator";

type Configuration = NonNullable<ReturnType<typeof browserCloudConfig>>;

// Loaded only when cloud is active on this page (see cloud-provider.tsx). Keeping AuthKit and
// Convex in this module keeps them out of the main bundle for users who never use cloud.
export default function CloudSession({
  configuration,
  children,
}: {
  configuration: Configuration;
  children: ReactNode;
}) {
  // Created once and never closed here: StrictMode and remounts would otherwise close a live client.
  const client = useMemo(
    () => new ConvexReactClient(configuration.url, { unsavedChangesWarning: false }),
    [configuration],
  );
  const [activeTeamId, setActive] = useState<string | null>(() => readActiveTeamId());
  const setActiveTeamId = useCallback((id: string | null) => {
    setActive(id);
    writeActiveTeamId(id);
  }, []);
  useEffect(() => {
    markCloudUsed();
  }, []);
  const value = useMemo<CloudState>(
    () => ({
      configured: true,
      available: true,
      activeTeamId,
      setActiveTeamId,
      // Already active: nothing to start.
      activate() {},
    }),
    [activeTeamId, setActiveTeamId],
  );
  const router = useRouter();
  const onRedirectCallback = useCallback(
    ({ state }: { state?: unknown }) => {
      // The dedicated /callback page has nothing to show, so fall back to Team.
      const target =
        safeReturnTo(returnToFromState(state)) ??
        (window.location.pathname === "/callback" ? "/team" : null);
      if (!target) {
        // No usable return path: drop the one-time OAuth params and stay on this page.
        const url = new URL(window.location.href);
        url.searchParams.delete("code");
        url.searchParams.delete("state");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        return;
      }
      // AuthKit removes code/state from the URL after this callback returns. Navigate after that
      // so the router, not AuthKit's replaceState, has the final say on the URL.
      window.setTimeout(() => {
        router
          .navigate({ href: target, replace: true })
          .catch(() => window.location.replace(target));
      }, 0);
    },
    [router],
  );
  const session = (
    <ConvexProviderWithAuth client={client} useAuth={useConvexCloudAuth}>
      <CloudContext.Provider value={value}>{children}</CloudContext.Provider>
    </ConvexProviderWithAuth>
  );
  if (configuration.desktop)
    return <DesktopAuth configuration={configuration}>{session}</DesktopAuth>;
  return (
    <AuthKitProvider
      clientId={configuration.clientId}
      redirectUri={configuration.redirectUri}
      devMode={configuration.devMode}
      onRedirectCallback={onRedirectCallback}
      {...(configuration.apiHostname ? { apiHostname: configuration.apiHostname } : {})}
    >
      <WebAuth>{session}</WebAuth>
    </AuthKitProvider>
  );
}

function WebAuth({ children }: { children: ReactNode }) {
  const { isLoading, user, signIn, signOut, getAccessToken } = useAuth();
  const value = useMemo<CloudAuth>(
    () => ({
      isLoading,
      user,
      signIn: ({ returnTo } = {}) => signIn(returnTo ? { state: { returnTo } } : undefined),
      signOut: () => signOut(),
      getAccessToken: (forceRefresh) =>
        getAccessToken({ forceRefresh }).catch(() => null) as Promise<string | null>,
    }),
    [isLoading, user, signIn, signOut, getAccessToken],
  );
  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>;
}

// The desktop renderer runs on a custom origin that AuthKit cannot use, so the main process signs
// in through the system browser and hands the renderer access tokens over IPC.
function DesktopAuth({
  configuration,
  children,
}: {
  configuration: Configuration;
  children: ReactNode;
}) {
  const [state, setState] = useState<CloudAuthState>({ user: null, loading: true });
  const config = useMemo(
    () => ({
      clientId: configuration.clientId,
      ...(configuration.apiHostname ? { apiHostname: configuration.apiHostname } : {}),
    }),
    [configuration],
  );
  useEffect(() => {
    const bridge = nativeBridge();
    let active = true;
    const unsubscribe = bridge?.cloudAuthSubscribe?.((next) => active && setState(next));
    void bridge
      ?.cloudAuthConfigure?.(config)
      .then((next) => active && setState(next))
      .catch(() => active && setState({ user: null, loading: false }));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [config]);
  const value = useMemo<CloudAuth>(
    () => ({
      isLoading: state.loading,
      user: state.user,
      signIn: async () => {
        const next = await nativeBridge()?.cloudAuthSignIn?.(config);
        if (next) setState(next);
      },
      signOut: () => void nativeBridge()?.cloudAuthSignOut?.(),
      getAccessToken: async (forceRefresh) =>
        (await nativeBridge()
          ?.cloudAuthToken?.(forceRefresh)
          .catch(() => null)) ?? null,
    }),
    [state, config],
  );
  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>;
}

export function useConvexCloudAuth() {
  const { isLoading, user, getAccessToken } = useCloudAuth();
  const fetchAccessToken = useCallback(
    ({ forceRefreshToken }: { forceRefreshToken: boolean }) => getAccessToken(forceRefreshToken),
    [getAccessToken],
  );
  return { isLoading, isAuthenticated: !!user, fetchAccessToken };
}
