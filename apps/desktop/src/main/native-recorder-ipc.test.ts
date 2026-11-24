/* eslint-disable typescript/no-explicit-any -- Partial Electron boundary mocks. */
import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vite-plus/test";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  dialog: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => ({ isVisible: () => true }) },
  dialog: { showMessageBox: mock.dialog },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => mock.handlers.set(name, handler),
  },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
}));
import { registerNativeRecorder } from "./native-recorder-ipc.ts";
import { bridgeChannels } from "../shared/bridge.ts";

let sender: any;
let recorder: any;
beforeEach(() => {
  mock.handlers.clear();
  mock.dialog.mockReset();
  sender = Object.assign(new EventEmitter(), {
    mainFrame: { url: "trusted" },
    isDestroyed: () => false,
  });
  recorder = {
    devices: vi.fn().mockResolvedValue([]),
    start: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue({}),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    retry: vi.fn(),
    close: vi.fn(),
    streamStatus: vi.fn().mockReturnValue({ state: "requested" }),
  };
  registerNativeRecorder(recorder, (url) => url === "trusted", false);
});
it("rejects untrusted frames and headless requests", async () => {
  const list = mock.handlers.get(bridgeChannels.nativeRecordingList)!;
  await expect(list({ sender, senderFrame: { url: "trusted" } })).rejects.toThrow("Untrusted");
  sender.mainFrame.url = "untrusted";
  await expect(list({ sender, senderFrame: sender.mainFrame })).rejects.toThrow("Untrusted");
  registerNativeRecorder(recorder, () => true, true);
  await expect(
    mock.handlers.get(bridgeChannels.nativeRecordingList)!({
      sender,
      senderFrame: sender.mainFrame,
    }),
  ).rejects.toThrow("Untrusted");
});
it("rejects a confirmation after navigation and prevents duplicate starts", async () => {
  let answer!: (value: { response: number }) => void;
  mock.dialog.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const start = mock.handlers.get(bridgeChannels.nativeRecordingStart)!;
  const event = { sender, senderFrame: sender.mainFrame };
  const request = { projectID: "project", source: "screen", encoder: "software" };
  const pending = start(event, request);
  await vi.waitFor(() => expect(mock.dialog).toHaveBeenCalled());
  await expect(start(event, request)).rejects.toThrow("Another native recording");
  sender.emit("did-start-navigation", {}, "trusted", false, true);
  answer({ response: 1 });
  await expect(pending).rejects.toThrow("expired");
  expect(recorder.start).not.toHaveBeenCalled();
});
it("stops an owned recording when its renderer is destroyed", async () => {
  mock.dialog.mockResolvedValue({ response: 1 });
  await mock.handlers.get(bridgeChannels.nativeRecordingStart)!(
    { sender, senderFrame: sender.mainFrame },
    { projectID: "project", source: "screen", encoder: "auto" },
  );
  sender.emit("destroyed");
  await vi.waitFor(() => expect(recorder.stop).toHaveBeenCalledOnce());
});
it("confirms the streaming host without exposing its key and restricts status to its owner", async () => {
  mock.dialog.mockResolvedValue({ response: 1 });
  const event = { sender, senderFrame: sender.mainFrame };
  const streamURL = "rtmps://example.test/live/private-stream-key";
  await mock.handlers.get(bridgeChannels.nativeRecordingStart)!(event, {
    projectID: "project",
    source: "screen",
    encoder: "software",
    streamURL,
  });
  const confirmation = mock.dialog.mock.calls[0]?.[1];
  expect(confirmation.message).toContain("rtmps://example.test");
  expect(JSON.stringify(confirmation)).not.toContain("private-stream-key");
  expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({ streamURL }));
  const status = mock.handlers.get(bridgeChannels.nativeRecordingStreamStatus)!;
  expect(status(event)).toEqual({ state: "requested" });
  expect(() =>
    status({
      sender: Object.assign(new EventEmitter(), { mainFrame: sender.mainFrame }),
      senderFrame: sender.mainFrame,
    }),
  ).toThrow("owned");
});
it("rejects stream destination injection before requesting confirmation or devices", async () => {
  await expect(
    mock.handlers.get(bridgeChannels.nativeRecordingStart)!(
      { sender, senderFrame: sender.mainFrame },
      {
        projectID: "project",
        source: "screen",
        encoder: "software",
        streamURL: "rtmp://host/live/key|file.mkv",
      },
    ),
  ).rejects.toThrow("destination");
  expect(mock.dialog).not.toHaveBeenCalled();
  expect(recorder.devices).not.toHaveBeenCalled();
  expect(recorder.start).not.toHaveBeenCalled();
});
it("stops only the recording a late start created when the renderer is destroyed during start", async () => {
  mock.dialog.mockResolvedValue({ response: 1 });
  let created!: (value: { id: string }) => void;
  recorder.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        created = resolve;
      }),
  );
  const event = { sender, senderFrame: sender.mainFrame };
  const pending = mock.handlers.get(bridgeChannels.nativeRecordingStart)!(event, {
    projectID: "project",
    source: "screen",
    encoder: "auto",
  });
  await vi.waitFor(() => expect(recorder.start).toHaveBeenCalled());
  sender.emit("destroyed");
  expect(recorder.stop).not.toHaveBeenCalled(); // nothing was published to this owner yet
  created({ id: "late" });
  await expect(pending).rejects.toThrow("expired");
  expect(recorder.stop).toHaveBeenCalledOnce();
  // The slot is released, so another start is not blocked by the dead owner.
  recorder.start.mockResolvedValue({ id: "next" });
  await expect(
    mock.handlers.get(bridgeChannels.nativeRecordingStart)!(event, {
      projectID: "project",
      source: "screen",
      encoder: "auto",
    }),
  ).resolves.toEqual({ id: "next" });
});
it("accepts a program source without device lookup and forwards validated chunks", async () => {
  mock.dialog.mockResolvedValue({ response: 1 });
  const event = { sender, senderFrame: sender.mainFrame };
  await mock.handlers.get(bridgeChannels.nativeRecordingStart)!(event, {
    projectID: "project",
    source: "program",
    encoder: "software",
  });
  expect(recorder.devices).not.toHaveBeenCalled();
  expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({ source: "program" }));
  const write = mock.handlers.get(bridgeChannels.nativeRecordingWrite)!;
  const bytes = new Uint8Array([1, 2, 3]);
  await write(event, "rec-1", bytes);
  expect(recorder.write).toHaveBeenCalledWith("rec-1", bytes);
  await expect(write(event, "rec-1", "not-bytes")).rejects.toThrow("Invalid");
  await expect(write(event, 42, bytes)).rejects.toThrow("Invalid");
  await expect(write(event, "rec-1", new Uint8Array(16 * 1024 * 1024 + 1))).rejects.toThrow(
    "Invalid",
  );
});
it("rejects program requests that carry capture devices", async () => {
  const event = { sender, senderFrame: sender.mainFrame };
  for (const extra of [{ deviceID: "cam" }, { microphoneID: "mic" }]) {
    await expect(
      mock.handlers.get(bridgeChannels.nativeRecordingStart)!(event, {
        projectID: "project",
        source: "program",
        encoder: "software",
        ...extra,
      }),
    ).rejects.toThrow("Invalid");
  }
  expect(mock.dialog).not.toHaveBeenCalled();
  expect(recorder.start).not.toHaveBeenCalled();
});
it("rejects a second stop and status from a stopped owner", async () => {
  mock.dialog.mockResolvedValue({ response: 1 });
  const event = { sender, senderFrame: sender.mainFrame };
  await mock.handlers.get(bridgeChannels.nativeRecordingStart)!(event, {
    projectID: "project",
    source: "screen",
    encoder: "auto",
  });
  const stop = mock.handlers.get(bridgeChannels.nativeRecordingStop)!;
  await stop(event);
  await expect(stop(event)).rejects.toThrow("No native recording owned");
  expect(recorder.stop).toHaveBeenCalledOnce();
});
