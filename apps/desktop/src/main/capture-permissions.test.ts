/* eslint-disable typescript/no-explicit-any -- Electron boundary mocks have partial shapes. */
import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  request: undefined as any,
  check: undefined as any,
  display: undefined as any,
  dialog: vi.fn(),
  sources: vi.fn(),
  status: vi.fn(),
  contents: undefined as any,
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => ({}) },
  desktopCapturer: { getSources: electron.sources },
  dialog: { showMessageBox: electron.dialog },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) =>
      electron.handlers.set(name, handler),
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: (handler: any) => {
        electron.request = handler;
      },
      setPermissionCheckHandler: (handler: any) => {
        electron.check = handler;
      },
      setDisplayMediaRequestHandler: (handler: any) => {
        electron.display = handler;
      },
    },
  },
  systemPreferences: { getMediaAccessStatus: electron.status },
  webContents: { fromFrame: () => electron.contents },
}));
import { registerCapturePermissions } from "./capture-permissions";
import { bridgeChannels } from "../shared/bridge";

const id = "00000000-0000-0000-0000-000000000000";
let contents: EventEmitter & {
  id: number;
  mainFrame: { url: string };
  getURL: () => string;
  isDestroyed: () => boolean;
};
let event: { sender: typeof contents; senderFrame: typeof contents.mainFrame };
const prepare = (source: string, display?: string) =>
  electron.handlers.get(bridgeChannels.capturePrepare)!(event, id, {
    source,
    microphone: false,
    ...(display ? { display } : {}),
  });
const request = (permission: string, url = "trusted", isMainFrame = true) => {
  let allowed: boolean | undefined;
  electron.request(contents, permission, (value: boolean) => (allowed = value), {
    isMainFrame,
    requestingUrl: url,
  });
  return allowed;
};
const display = (audioRequested = false) =>
  new Promise<any>((resolve) =>
    electron.display(
      {
        frame: contents.mainFrame,
        securityOrigin: "trusted",
        videoRequested: true,
        audioRequested,
      },
      resolve,
    ),
  );

beforeEach(() => {
  electron.handlers.clear();
  electron.dialog.mockReset().mockResolvedValue({ response: 1 });
  electron.status.mockReset().mockReturnValue("granted");
  electron.sources.mockReset().mockResolvedValue([
    { id: "screen:1", name: "Screen" },
    { id: "window:7:0", name: "Editor" },
  ]);
  contents = Object.assign(new EventEmitter(), {
    id: 1,
    mainFrame: { url: "trusted" },
    getURL: () => "trusted",
    isDestroyed: () => false,
  });
  event = { sender: contents, senderFrame: contents.mainFrame };
  electron.contents = contents;
  registerCapturePermissions((url) => url === "trusted");
});

it("lets the app's own page use the camera, microphone and screen without asking", async () => {
  await prepare("camera");
  expect(electron.dialog).not.toHaveBeenCalled();
  expect(request("media")).toBe(true);
  expect(request("display-capture")).toBe(true);
  expect(electron.check(contents, "media", "trusted", { isMainFrame: true })).toBe(true);
});

it("refuses other pages, frames and permissions", () => {
  expect(request("media", "https://elsewhere.example")).toBe(false);
  expect(request("media", "trusted", false)).toBe(false);
  expect(request("geolocation")).toBe(false);
  expect(
    electron.check(contents, "media", "https://elsewhere.example", { isMainFrame: true }),
  ).toBe(false);
});

it("points to system settings when the operating system blocks the device", async () => {
  if (!["win32", "darwin"].includes(process.platform)) return;
  electron.status.mockReturnValue("denied");
  await expect(prepare("camera")).rejects.toThrow("system privacy settings");
});

it("shares the screen picked in the app without a second picker", async () => {
  await prepare("screen", "window:7:0");
  expect((await display()).video.id).toBe("window:7:0");
  expect(electron.dialog).not.toHaveBeenCalled();
});

it("adds system sound on Windows when it is asked for", async () => {
  await prepare("screen", "screen:1");
  const result = await display(true);
  expect(result.video.id).toBe("screen:1");
  expect(result.audio).toBe(process.platform === "win32" ? "loopback" : undefined);
});

it("falls back to the system picker when nothing was picked in the app", async () => {
  expect((await display()).video.id).toBe("screen:1");
  expect(electron.dialog).toHaveBeenCalledTimes(1);
});

it("rejects a malformed picked source", async () => {
  await expect(prepare("screen", "../etc")).rejects.toThrow("Invalid capture request.");
});
