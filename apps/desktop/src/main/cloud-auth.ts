import { createHash, randomBytes } from "node:crypto";
import {
  createServer as nodeCreateServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { app, ipcMain, safeStorage, shell, webContents } from "electron";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { CloudAuthState, CloudAuthUser } from "@raee/contracts/desktop";
import { bridgeChannels } from "../shared/bridge.ts";

type Config = { clientId: string; apiHostname?: string };
type AuthResponse = { user?: unknown; access_token?: unknown; refresh_token?: unknown };
type CallbackServer = Pick<Server, "listen" | "address" | "close" | "once">;
type CloudAuthDeps = {
  fetch: typeof fetch;
  openExternal(url: string): Promise<unknown>;
  createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ): CallbackServer;
  readSecret(): Promise<string | null>;
  writeSecret(value: string | null): Promise<void>;
  now(): number;
};

const defaultHost = "api.workos.com";
const validateConfig = (value: unknown): Config => {
  if (!value || typeof value !== "object") throw new Error("Invalid WorkOS configuration.");
  const config = value as Record<string, unknown>;
  if (typeof config.clientId !== "string" || !/^client_[A-Za-z0-9]+$/.test(config.clientId))
    throw new Error("Invalid WorkOS client ID.");
  if (
    config.apiHostname !== undefined &&
    (typeof config.apiHostname !== "string" ||
      !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/.test(
        config.apiHostname,
      ))
  )
    throw new Error("Invalid WorkOS API hostname.");
  return {
    clientId: config.clientId,
    ...(config.apiHostname ? { apiHostname: config.apiHostname } : {}),
  };
};
const parseUser = (value: unknown): CloudAuthUser => {
  if (!value || typeof value !== "object") throw new Error("WorkOS returned an invalid user.");
  const user = value as Record<string, unknown>;
  if (typeof user.id !== "string" || typeof user.email !== "string")
    throw new Error("WorkOS returned an invalid user.");
  return {
    id: user.id,
    email: user.email,
    firstName: typeof user.first_name === "string" ? user.first_name : null,
    lastName: typeof user.last_name === "string" ? user.last_name : null,
    profilePictureUrl:
      typeof user.profile_picture_url === "string" ? user.profile_picture_url : null,
  };
};

export function createCloudAuth(deps: CloudAuthDeps) {
  let config: Config | undefined;
  let user: CloudAuthUser | null = null;
  let accessToken: string | null = null;
  let loading = false;
  let restoring: Promise<void> | undefined;
  let refresh: Promise<string | null> | undefined;
  let pendingSignIn: (() => void) | undefined;
  const subscribers = new Set<(state: CloudAuthState) => void>();
  const state = (): CloudAuthState => ({ user, loading });
  const publish = () => {
    const current = state();
    for (const listener of subscribers) listener(current);
  };
  const host = () => config?.apiHostname ?? defaultHost;
  const jwtExpiry = (token: string): number => {
    try {
      const payload = token.split(".")[1];
      const exp = payload && JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).exp;
      return typeof exp === "number" ? exp * 1000 : 0;
    } catch {
      return 0;
    }
  };
  const authenticate = async (body: Record<string, string>): Promise<AuthResponse> => {
    const response = await deps.fetch(`https://${host()}/user_management/authenticate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw Object.assign(new Error("WorkOS authentication failed."), { status: response.status });
    return (await response.json()) as AuthResponse;
  };
  // Bumped by sign-out; work started before it must not write a session back.
  let generation = 0;
  // Writes run in order, so a sign-out's clear always lands after a refresh already writing.
  let writes: Promise<void> = Promise.resolve();
  const writeSecret = (value: string | null) =>
    (writes = writes.then(
      () => deps.writeSecret(value),
      () => deps.writeSecret(value),
    ));
  const clear = async () => {
    user = null;
    accessToken = null;
    await writeSecret(null);
    publish();
  };
  const setTokens = async (result: AuthResponse) => {
    if (typeof result.access_token !== "string" || typeof result.refresh_token !== "string")
      throw new Error("WorkOS returned invalid tokens.");
    user = parseUser(result.user);
    accessToken = result.access_token;
    await writeSecret(result.refresh_token);
    publish();
  };
  const restore = async () => {
    const started = generation;
    loading = true;
    publish();
    try {
      // A sign-out's clear in progress must land before the saved token is read.
      await writes.catch(() => {});
      const secret = await deps.readSecret();
      if (secret && config && started === generation) {
        const result = await authenticate({
          client_id: config.clientId,
          grant_type: "refresh_token",
          refresh_token: secret,
        });
        if (started === generation) await setTokens(result);
      }
    } catch {
      if (started === generation) await clear();
    } finally {
      loading = false;
      publish();
    }
  };
  const configure = async (input: Config): Promise<CloudAuthState> => {
    config = validateConfig(input);
    if (!restoring) restoring = restore();
    await restoring;
    return state();
  };
  const signIn = async (input: Config): Promise<CloudAuthState> => {
    config = validateConfig(input);
    pendingSignIn?.();
    let cancel!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("Sign-in cancelled."));
    });
    pendingSignIn = cancel;
    loading = true;
    publish();
    const run = async () => {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const expectedState = randomBytes(32).toString("base64url");
      let finish!: (value: { code?: string; error?: string }) => void;
      const received = new Promise<{ code?: string; error?: string }>((resolve) => {
        finish = resolve;
      });
      const server = deps.createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method !== "GET" || url.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        const gotState = url.searchParams.get("state");
        const error =
          gotState !== expectedState
            ? "Sign-in state did not match."
            : (url.searchParams.get("error") ?? undefined);
        const code = error ? undefined : url.searchParams.get("code");
        response.writeHead(error ? 400 : 200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          `<html><body>${error ? "Sign-in failed. You can close this tab." : "Signed in to raE.E. You can close this tab."}</body></html>`,
        );
        finish(
          error
            ? { error }
            : code
              ? { code }
              : { error: "WorkOS did not return an authorization code." },
        );
      });
      const address = await new Promise<ReturnType<CallbackServer["address"]>>(
        (resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve(server.address()));
        },
      );
      if (!address || typeof address === "string")
        throw new Error("Could not start sign-in callback server.");
      const redirectUri = `http://127.0.0.1:${address.port}/callback`;
      const authorize = new URL(`https://${host()}/user_management/authorize`);
      authorize.search = new URLSearchParams({
        client_id: config!.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        provider: "authkit",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: expectedState,
      }).toString();
      let timeoutID: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timeoutID = setTimeout(() => reject(new Error("Sign-in timed out.")), 5 * 60_000);
        timeoutID.unref();
      });
      try {
        await Promise.race([deps.openExternal(authorize.toString()), timeout, cancelled]);
        const callback = await Promise.race([received, timeout, cancelled]);
        if (callback.error || !callback.code)
          throw new Error(callback.error ?? "WorkOS did not return an authorization code.");
        const result = await Promise.race([
          authenticate({
            client_id: config!.clientId,
            grant_type: "authorization_code",
            code: callback.code,
            code_verifier: verifier,
          }),
          cancelled,
        ]);
        await setTokens(result);
        return state();
      } finally {
        clearTimeout(timeoutID!);
        server.close();
        if (pendingSignIn === cancel) {
          pendingSignIn = undefined;
          loading = false;
          publish();
        }
      }
    };
    return run();
  };
  const getAccessToken = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<
    string | null
  > => {
    if (!forceRefresh && accessToken && jwtExpiry(accessToken) > deps.now() + 60_000)
      return accessToken;
    if (!config) return null;
    if (!refresh)
      refresh = (async () => {
        const started = generation;
        try {
          // Waits for a sign-out's clear in progress, so it can't read the old token.
          await writes.catch(() => {});
          const secret = await deps.readSecret();
          if (started !== generation) return null;
          if (!secret) return null;
          const result = await authenticate({
            client_id: config!.clientId,
            grant_type: "refresh_token",
            refresh_token: secret,
          });
          // Signed out while this was in flight: don't bring the session back.
          if (started !== generation) return null;
          await setTokens(result);
          return accessToken;
        } catch (error) {
          if (
            started === generation &&
            ((error as { status?: number }).status === 400 ||
              (error as { status?: number }).status === 401)
          )
            await clear();
          return null;
        } finally {
          refresh = undefined;
        }
      })();
    return refresh;
  };
  const signOut = async () => {
    generation += 1;
    pendingSignIn?.();
    pendingSignIn = undefined;
    loading = false;
    await clear();
  };
  const subscribe = (listener: (state: CloudAuthState) => void) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  };
  return { configure, signIn, signOut, getAccessToken, state, subscribe };
}

export function registerCloudAuth(isTrusted: (url: string) => boolean) {
  let memorySecret: string | null = null;
  const secretFile = join(app.getPath("userData"), "cloud-auth.bin");
  const controller = createCloudAuth({
    fetch,
    openExternal: (url) => shell.openExternal(url),
    createServer: (handler) => nodeCreateServer(handler),
    now: Date.now,
    readSecret: async () => {
      if (!safeStorage.isEncryptionAvailable()) return memorySecret;
      try {
        return safeStorage.decryptString(await readFile(secretFile));
      } catch {
        return null;
      }
    },
    writeSecret: async (value) => {
      memorySecret = value;
      if (!safeStorage.isEncryptionAvailable()) return;
      if (value === null) await unlink(secretFile).catch(() => {});
      else await writeFile(secretFile, safeStorage.encryptString(value), { mode: 0o600 });
    },
  });
  const validSender = (event: Electron.IpcMainInvokeEvent) =>
    Boolean(
      event.senderFrame &&
      event.senderFrame === event.sender.mainFrame &&
      isTrusted(event.senderFrame.url),
    );
  const handle = (channel: string, run: (value?: unknown) => unknown) =>
    ipcMain.handle(channel, (event, value?: unknown) => {
      if (!validSender(event)) throw new Error("Untrusted sender.");
      return run(value);
    });
  handle(bridgeChannels.cloudAuthConfigure, (value) => controller.configure(validateConfig(value)));
  handle(bridgeChannels.cloudAuthState, () => controller.state());
  handle(bridgeChannels.cloudAuthSignIn, (value) => controller.signIn(validateConfig(value)));
  handle(bridgeChannels.cloudAuthSignOut, () => controller.signOut());
  handle(bridgeChannels.cloudAuthToken, (value) => {
    if (typeof value !== "boolean") throw new Error("Invalid token refresh option.");
    return controller.getAccessToken({ forceRefresh: value });
  });
  controller.subscribe((state) => {
    for (const contents of webContents.getAllWebContents())
      if (!contents.isDestroyed() && isTrusted(contents.getURL()))
        contents.send(bridgeChannels.cloudAuthChanged, state);
  });
  return controller;
}
