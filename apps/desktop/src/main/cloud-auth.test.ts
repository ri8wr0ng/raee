import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createCloudAuth } from "./cloud-auth.ts";

const jwt = (exp: number) =>
  `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
const user = { id: "user_123", email: "a@example.com", first_name: "Ada", last_name: "Lovelace" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(fetch: typeof globalThis.fetch = vi.fn(), now = () => 1_700_000_000_000) {
  let secret: string | null = null;
  const openExternal = vi.fn(async (raw: string) => {
    const authorize = new URL(raw);
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", authorize.searchParams.get("state")!);
    callback.searchParams.set("code", "auth-code");
    await globalThis.fetch(callback);
  });
  const controller = createCloudAuth({
    fetch,
    openExternal,
    createServer: (handler) => createServer(handler),
    readSecret: async () => secret,
    writeSecret: async (value) => {
      secret = value;
    },
    now,
  });
  return { controller, openExternal, getSecret: () => secret };
}

afterEach(() => vi.restoreAllMocks());

describe("cloud auth", () => {
  it("builds a PKCE authorize URL and exchanges the code", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ user, access_token: jwt(1_800_000_000), refresh_token: "refresh-1" }),
      );
    const { controller, openExternal, getSecret } = setup(fetch);
    await controller.signIn({ clientId: "client_abc123" });
    const url = new URL(openExternal.mock.calls[0]![0]);
    expect(url.origin).toBe("https://api.workos.com");
    expect(url.pathname).toBe("/user_management/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("provider")).toBe("authkit");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.workos.com/user_management/authenticate",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({
      client_id: "client_abc123",
      grant_type: "authorization_code",
      code: "auth-code",
    });
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(body.code_verifier).digest("base64url"),
    );
    expect(getSecret()).toBe("refresh-1");
  });

  it("rejects a mismatched callback state", async () => {
    const fetch = vi.fn();
    const { controller, openExternal } = setup(fetch);
    openExternal.mockImplementationOnce(async (raw) => {
      const authorize = new URL(raw);
      const callback = new URL(authorize.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", "wrong");
      callback.searchParams.set("code", "auth-code");
      await globalThis.fetch(callback);
    });
    await expect(controller.signIn({ clientId: "client_abc123" })).rejects.toThrow(
      "state did not match",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses a cached token until it is close to expiry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ user, access_token: jwt(1_800_000_000), refresh_token: "refresh" }),
      );
    const { controller } = setup(fetch);
    await controller.configure({ clientId: "client_abc123" });
    // Seed a session through the real sign-in path.
    await controller.signIn({ clientId: "client_abc123" });
    fetch.mockClear();
    expect(await controller.getAccessToken()).toBe(jwt(1_800_000_000));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes when forced", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({ user, access_token: jwt(1_800_000_000), refresh_token: "refresh-1" }),
      )
      .mockResolvedValueOnce(
        response({ user, access_token: jwt(1_900_000_000), refresh_token: "refresh-2" }),
      );
    const { controller, getSecret } = setup(fetch);
    await controller.signIn({ clientId: "client_abc123" });
    expect(await controller.getAccessToken({ forceRefresh: true })).toBe(jwt(1_900_000_000));
    expect(getSecret()).toBe("refresh-2");
  });

  it("refreshes a cached token within 60 seconds of expiry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({ user, access_token: jwt(1_700_000_030), refresh_token: "refresh-1" }),
      )
      .mockResolvedValueOnce(
        response({ user, access_token: jwt(1_800_000_000), refresh_token: "refresh-2" }),
      );
    const { controller } = setup(fetch);
    await controller.signIn({ clientId: "client_abc123" });
    expect(await controller.getAccessToken()).toBe(jwt(1_800_000_000));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clears the session after a rejected refresh", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({ user, access_token: jwt(1_800_000_000), refresh_token: "refresh-1" }),
      )
      .mockResolvedValueOnce(response({ error: "invalid_grant" }, 401));
    const { controller, getSecret } = setup(fetch);
    await controller.signIn({ clientId: "client_abc123" });
    expect(await controller.getAccessToken({ forceRefresh: true })).toBeNull();
    expect(controller.state().user).toBeNull();
    expect(getSecret()).toBeNull();
  });

  it("restores a saved session on first configure", async () => {
    let secret: string | null = "persisted";
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ user, access_token: jwt(1_800_000_000), refresh_token: "rotated" }),
      );
    const controller = createCloudAuth({
      fetch,
      openExternal: async () => {},
      createServer: (handler) => createServer(handler),
      readSecret: async () => secret,
      writeSecret: async (value) => {
        secret = value;
      },
      now: Date.now,
    });
    expect(await controller.configure({ clientId: "client_abc123" })).toMatchObject({
      user: { id: "user_123" },
      loading: false,
    });
    expect(secret).toBe("rotated");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
