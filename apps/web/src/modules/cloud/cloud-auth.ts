import { createContext, useContext } from "react";

// One sign-in interface for the browser (AuthKit) and the desktop app (main-process sign-in).
// Dependency-free so components can import it without loading AuthKit.

export type CloudUser = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};

export type CloudAuth = {
  isLoading: boolean;
  user: CloudUser | null;
  /** Starts sign-in. In the browser the page leaves and comes back to `returnTo`. */
  signIn(options?: { returnTo?: string }): Promise<void>;
  signOut(): void;
  getAccessToken(forceRefresh: boolean): Promise<string | null>;
};

export const CloudAuthContext = createContext<CloudAuth | null>(null);

/** Only call inside CloudProvider when cloud is configured. */
export function useCloudAuth(): CloudAuth {
  const auth = useContext(CloudAuthContext);
  if (!auth) throw new Error("useCloudAuth needs an active cloud session.");
  return auth;
}
