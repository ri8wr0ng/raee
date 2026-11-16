import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  systemPreferences,
  webContents,
} from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { bridgeChannels } from "../shared/bridge";

type Picked = { id: string; display: string; expires: number };

/**
 * The app's own page may use the camera, microphone and screen like any desktop recorder;
 * the operating system's privacy settings are the gate. Other pages and frames get nothing.
 */
export function registerCapturePermissions(isTrusted: (url: string) => boolean) {
  const picked = new Map<number, Picked>();
  const check = (event: IpcMainInvokeEvent) => {
    if (
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrusted(event.senderFrame.url)
    )
      throw new Error("Untrusted capture sender.");
  };
  const trusted = (contents: Electron.WebContents | null, url: string, isMainFrame: boolean) =>
    Boolean(contents) && isMainFrame && isTrusted(url) && isTrusted(contents!.getURL());

  ipcMain.handle(bridgeChannels.capturePrepare, async (event, id: unknown, input: unknown) => {
    check(event);
    if (
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(id) ||
      !input ||
      typeof input !== "object" ||
      !("source" in input) ||
      !["screen", "camera", "microphone"].includes(String(input.source)) ||
      !("microphone" in input) ||
      typeof input.microphone !== "boolean" ||
      ("display" in input &&
        input.display !== undefined &&
        (typeof input.display !== "string" ||
          !/^(screen|window):[\w:-]{1,100}$/.test(input.display)))
    )
      throw new Error("Invalid capture request.");
    const source = input.source;
    const kinds = [
      source === "camera" ? "camera" : null,
      source === "microphone" || input.microphone ? "microphone" : null,
    ] as const;
    for (const kind of kinds) {
      if (!kind || !["win32", "darwin"].includes(process.platform)) continue;
      let status = systemPreferences.getMediaAccessStatus(kind);
      if (status === "not-determined" && process.platform === "darwin")
        status = (await systemPreferences.askForMediaAccess(kind)) ? "granted" : "denied";
      if (status === "denied" || status === "restricted")
        throw new Error(`Allow ${kind} access in system privacy settings, then retry.`);
    }
    const display = "display" in input ? input.display : undefined;
    if (source === "screen" && typeof display === "string")
      picked.set(event.sender.id, { id, display, expires: Date.now() + 60_000 });
  });
  ipcMain.handle(bridgeChannels.captureRelease, (event, id: unknown) => {
    check(event);
    if (picked.get(event.sender.id)?.id === id) picked.delete(event.sender.id);
  });
  ipcMain.handle(bridgeChannels.captureSources, async (event) => {
    check(event);
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: source.thumbnail.toDataURL(),
    }));
  });

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      (permission === "media" || permission === "display-capture") &&
        trusted(contents, details.requestingUrl, details.isMainFrame),
    ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      (permission === "media" || permission === "display-capture") &&
      trusted(contents, origin, details.isMainFrame),
  );
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const contents = request.frame && webContents.fromFrame(request.frame);
    if (
      !contents ||
      request.frame !== contents.mainFrame ||
      !trusted(contents, request.securityOrigin, true) ||
      !request.videoRequested
    ) {
      callback({});
      return;
    }
    // System sound can be captured on Windows only.
    const audio = request.audioRequested && process.platform === "win32" ? "loopback" : undefined;
    const choice = picked.get(contents.id);
    picked.delete(contents.id);
    void (async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        let selected =
          choice && choice.expires > Date.now()
            ? sources.find((source) => source.id === choice.display)
            : undefined;
        if (!selected && !choice) {
          const window = BrowserWindow.fromWebContents(contents);
          if (!window) throw new Error("Recording window is closed.");
          const answer = await dialog.showMessageBox(window, {
            title: "Choose a recording source",
            message: "Choose a screen or window to record",
            buttons: ["Cancel", ...sources.map((source) => source.name)],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          selected = sources[answer.response - 1];
        }
        if (!selected || contents.isDestroyed() || request.frame !== contents.mainFrame) {
          callback({});
          return;
        }
        callback(audio ? { video: selected, audio } : { video: selected });
      } catch {
        callback({});
      }
    })();
  });
}
