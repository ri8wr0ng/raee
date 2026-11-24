import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, expect, it, vi } from "vite-plus/test";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  ipcMain: {
    on: () => {},
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mock.handlers.set(name, handler),
  },
}));
import { registerNativeIPC } from "./native-ipc.ts";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { bridgeChannels } from "../shared/bridge.ts";

beforeEach(() => mock.handlers.clear());

it("returns only the support report through a trusted no-argument IPC call", async () => {
  const root = await mkdtemp(join(tmpdir(), "raee-support-ipc-"));
  const host = new HostProjectService(new NativeProjectStore(join(root, "private-project.tandem")));
  await host.start();
  const close = registerNativeIPC(host, (url) => url === "trusted", new ProjectAPI(host));
  try {
    const handler = mock.handlers.get(bridgeChannels.supportReport);
    assert.ok(handler);
    const frame = { url: "trusted" },
      sender = { mainFrame: frame, isDestroyed: () => false },
      event = { senderFrame: frame, sender };
    const before = host.snapshot().json,
      files = (await readdir(root)).sort();
    const text = await handler(event);
    assert.ok(typeof text === "string");
    const report = JSON.parse(text);
    expect(report).toMatchObject({ format: "raee-support", version: 1 });
    expect(report).not.toHaveProperty("output");
    expect(report).not.toHaveProperty("report");
    expect(text).not.toContain(root);
    expect(text).not.toContain("private-project.tandem");
    expect(host.snapshot().json).toBe(before);
    expect((await readdir(root)).sort()).toEqual(files);
    await expect(handler(event, { output: "outside.json" })).rejects.toThrow(/arguments/);
    await expect(handler({ ...event, senderFrame: { url: "trusted" } })).rejects.toThrow(
      /Untrusted/,
    );
    await expect(handler({ ...event, senderFrame: null })).rejects.toThrow(/Untrusted/);
    await expect(
      handler({ senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => true } }),
    ).rejects.toThrow(/Untrusted/);
    const outside = { url: "https://untrusted.test" };
    await expect(
      handler({ senderFrame: outside, sender: { ...sender, mainFrame: outside } }),
    ).rejects.toThrow(/Untrusted/);
    const navigated = handler(event);
    frame.url = "https://untrusted.test";
    await expect(navigated).rejects.toThrow(/Untrusted/);
    frame.url = "trusted";
    const destroyed = handler(event);
    sender.isDestroyed = () => true;
    await expect(destroyed).rejects.toThrow(/Untrusted/);
  } finally {
    await close();
    assert.ok(root.startsWith(join(tmpdir(), "raee-support-ipc-")));
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses the report when the host API is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "raee-support-ipc-"));
  const host = new HostProjectService(new NativeProjectStore(join(root, "project.tandem")));
  await host.start();
  const close = registerNativeIPC(host, () => true);
  try {
    const handler = mock.handlers.get(bridgeChannels.supportReport);
    assert.ok(handler);
    const frame = { url: "trusted" };
    await expect(
      handler({ senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } }),
    ).rejects.toThrow(/unavailable/);
  } finally {
    await close();
    assert.ok(root.startsWith(join(tmpdir(), "raee-support-ipc-")));
    await rm(root, { recursive: true, force: true });
  }
});

it("resolves Kick channel slugs to chatroom IDs through trusted IPC", async () => {
  const root = await mkdtemp(join(tmpdir(), "raee-kick-ipc-"));
  const host = new HostProjectService(new NativeProjectStore(join(root, "project.tandem")));
  await host.start();
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("channels/streamer")) {
      return new Response(JSON.stringify({ id: 101, slug: "streamer", chatroom: { id: 998877 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("channels/noroom")) {
      return new Response(JSON.stringify({ id: 101, slug: "noroom" }), { status: 200 });
    }
    if (url.includes("channels/notfound")) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response("Server error", { status: 500 });
  };
  const close = registerNativeIPC(host, (url) => url === "trusted", undefined, mockFetch);
  try {
    const handler = mock.handlers.get(bridgeChannels.kickChannelLookup);
    assert.ok(handler);
    const frame = { url: "trusted" };
    const sender = { mainFrame: frame, isDestroyed: () => false };
    const event = { senderFrame: frame, sender };

    // Successful lookup
    const result = await handler(event, "streamer");
    expect(result).toEqual({ chatroomId: 998877, channelSlug: "streamer" });

    // A channel without a chatroom never falls back to the channel id
    await expect(handler(event, "noroom")).rejects.toThrow(/chatroom ID/);

    // 404 lookup
    await expect(handler(event, "notfound")).rejects.toThrow(/not found/);

    // Invalid slug
    await expect(handler(event, "")).rejects.toThrow(/Invalid Kick channel slug/);
    await expect(handler(event, "bad/slug?query")).rejects.toThrow(/Invalid Kick channel slug/);

    // Untrusted sender
    const untrustedFrame = { url: "https://evil.com" };
    await expect(
      handler(
        {
          senderFrame: untrustedFrame,
          sender: { mainFrame: untrustedFrame, isDestroyed: () => false },
        },
        "streamer",
      ),
    ).rejects.toThrow(/Untrusted/);
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
});
