import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { bridgeChannels } from "../shared/bridge.ts";
import type { HostProjectService } from "./project-service.ts";
import { StableFolderWatch } from "./folder-scanner.ts";
import { NativeMedia } from "./native-media.ts";
import { mediaBinaries } from "./media-binaries.ts";
import type { ProjectAPI } from "./project-api.ts";

export function registerNativeIPC(
  project: HostProjectService,
  isTrusted: (url: string) => boolean,
  api?: ProjectAPI,
  request: typeof fetch = globalThis.fetch,
) {
  const folders = new Map<number, StableFolderWatch>(),
    jobs = new Map<string, AbortController>();
  const running = new Set<Promise<unknown>>();
  const binaries = mediaBinaries(process.env, app.isPackaged ? process.resourcesPath : undefined);
  const media = new NativeMedia(binaries.ffmpeg, binaries.ffprobe);
  const check = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    if (
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrusted(event.senderFrame.url)
    )
      throw new Error("Untrusted native sender.");
  };
  project.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.webContents.isDestroyed() && isTrusted(window.webContents.getURL()))
        window.webContents.send(bridgeChannels.projectChanged, snapshot);
  });
  ipcMain.on(bridgeChannels.projectRequest, (event, json: unknown) => {
    try {
      check(event);
      event.returnValue = { value: project.request(json) };
    } catch (error) {
      event.returnValue = { error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(bridgeChannels.projectFlush, async (event) => {
    check(event);
    await project.flush();
  });
  ipcMain.handle(bridgeChannels.supportReport, async (event, ...args: unknown[]) => {
    check(event);
    if (event.sender.isDestroyed()) throw new Error("Untrusted native sender.");
    if (args.length) throw new Error("Support report takes no arguments.");
    if (!api) throw new Error("Project service is unavailable.");
    const result: unknown = await api.handle("diagnostics", {});
    check(event);
    if (event.sender.isDestroyed()) throw new Error("Untrusted native sender.");
    if (!result || typeof result !== "object" || !("report" in result))
      throw new Error("Support report is unavailable.");
    return JSON.stringify(result.report, null, 2) + "\n";
  });
  ipcMain.handle(bridgeChannels.projectResource, async (event, id: unknown) => {
    check(event);
    if (!api) throw new Error("Project service is unavailable.");
    try {
      return await api.readProjectResource(id);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    }
  });
  ipcMain.handle(bridgeChannels.projectImport, async (event, json: unknown) => {
    check(event);
    if (typeof json !== "string" || json.length > 20 * 1024 * 1024)
      throw new Error("Invalid project import.");
    const snapshot = await project.replace(json);
    api?.setMediaRoot(null);
    for (const folder of folders.values()) folder.close();
    folders.clear();
    return snapshot;
  });
  ipcMain.handle(bridgeChannels.projectReload, async (event, backup: unknown) => {
    check(event);
    if (typeof backup !== "boolean") throw new Error("Invalid recovery choice.");
    return project.replace(undefined, backup);
  });
  ipcMain.handle(bridgeChannels.folderSelect, async (event) => {
    check(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Native window is closed.");
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Watch a media folder",
    });
    if (result.canceled || !result.filePaths[0]) return;
    api?.setMediaRoot(result.filePaths[0]);
    folders.get(event.sender.id)?.close();
    const watcher = new StableFolderWatch(result.filePaths[0], (files, error) => {
      if (!event.sender.isDestroyed() && isTrusted(event.sender.getURL()))
        event.sender.send(bridgeChannels.folderChanged, files, error);
    });
    folders.set(event.sender.id, watcher);
    event.sender.once("destroyed", () => {
      watcher.close();
      folders.delete(event.sender.id);
    });
    await watcher.start();
  });
  ipcMain.handle(
    bridgeChannels.nativeMedia,
    async (
      event,
      id: unknown,
      operation: unknown,
      bytes: unknown,
      start: unknown,
      duration: unknown,
    ) => {
      check(event);
      if (
        typeof id !== "string" ||
        !/^[a-z0-9-]{1,100}$/i.test(id) ||
        (start !== undefined && typeof start !== "number") ||
        (duration !== undefined && typeof duration !== "number")
      )
        throw new Error("Invalid media request.");
      const key = `${event.sender.id}:${id}`;
      if ([...jobs.keys()].some((entry) => entry.startsWith(`${event.sender.id}:`)))
        throw new Error("A native media job is already running in this window.");
      const controller = new AbortController(),
        stop = () => controller.abort();
      jobs.set(key, controller);
      event.sender.once("destroyed", stop);
      try {
        const task = media.run(
          operation,
          bytes,
          controller.signal,
          (progress) => {
            if (!event.sender.isDestroyed())
              event.sender.send(bridgeChannels.nativeProgress, id, progress);
          },
          start,
          duration,
        );
        running.add(task);
        try {
          return await task;
        } finally {
          running.delete(task);
        }
      } finally {
        jobs.delete(key);
        event.sender.removeListener("destroyed", stop);
      }
    },
  );
  ipcMain.handle(bridgeChannels.nativeCancel, (event, id: unknown) => {
    check(event);
    if (typeof id !== "string") throw new Error("Invalid media cancellation.");
    jobs.get(`${event.sender.id}:${id}`)?.abort();
  });
  ipcMain.handle(bridgeChannels.kickChannelLookup, async (event, slug: unknown) => {
    check(event);
    if (event.sender.isDestroyed()) throw new Error("Untrusted native sender.");
    if (typeof slug !== "string" || !/^[a-zA-Z0-9_.-]{1,100}$/.test(slug.trim())) {
      throw new Error("Invalid Kick channel slug.");
    }
    const trimmed = slug.trim().toLowerCase();
    // Unofficial: Kick has no public OAuth chat API, public web endpoint resolves channel slug to chatroom ID
    const response = await request(
      `https://kick.com/api/v2/channels/${encodeURIComponent(trimmed)}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    );
    if (!response.ok) {
      if (response.status === 404) throw new Error(`Kick channel "${trimmed}" not found.`);
      throw new Error(`Kick channel lookup failed with status ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    const body = declared > 512_000 ? "" : await response.text();
    if (!body || body.length > 512_000)
      throw new Error("Kick channel lookup returned too much data.");
    let data: { chatroom?: { id?: unknown }; slug?: unknown };
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      throw new Error("Kick channel lookup returned an unreadable answer.");
    }
    // The channel's own id is not its chatroom; joining it would read the wrong room.
    const chatroomId = data.chatroom?.id;
    if (typeof chatroomId !== "number" || chatroomId <= 0) {
      throw new Error(`Could not resolve chatroom ID for Kick channel "${trimmed}".`);
    }
    return { chatroomId, channelSlug: typeof data.slug === "string" ? data.slug : trimmed };
  });
  return async () => {
    for (const folder of folders.values()) folder.close();
    for (const job of jobs.values()) job.abort();
    await Promise.allSettled([...running]);
    await project.close();
  };
}
