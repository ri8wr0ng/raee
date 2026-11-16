import { app, ipcMain, shell, webContents } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { UpdateState } from "@sidecut/contracts/desktop";
import { bridgeChannels } from "../shared/bridge.ts";
import { createUpdateController } from "./updater.ts";

const RELEASES = "https://github.com/sharull9/SideCut/releases";
const CHECK_EVERY = 4 * 60 * 60 * 1000;

/** Only packaged builds update; dev, smoke and headless runs answer "idle" and do nothing. */
export async function registerUpdater(isTrusted: (url: string) => boolean, enabled: boolean) {
  let controller: ReturnType<typeof createUpdateController> | undefined;
  const handle = (channel: string, run: () => unknown) =>
    ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        !isTrusted(event.senderFrame.url)
      )
        throw new Error("Untrusted sender.");
      return run();
    });
  handle(bridgeChannels.updateState, () => controller?.state() ?? { status: "idle" });
  handle(bridgeChannels.updateCheck, () => controller?.check());
  handle(bridgeChannels.updateDownload, () => controller?.download());
  handle(bridgeChannels.updateInstall, () => controller?.install());
  if (!enabled) return;

  const { autoUpdater } = (await import("electron-updater")).default;
  controller = createUpdateController(autoUpdater, {
    manualInstall: process.platform === "darwin",
    openRelease: (version) => shell.openExternal(`${RELEASES}/tag/v${version}`),
    publish: (state: UpdateState) => {
      for (const contents of webContents.getAllWebContents())
        if (!contents.isDestroyed() && isTrusted(contents.getURL()))
          contents.send(bridgeChannels.updateChanged, state);
    },
  });
  const check = () => void controller?.check();
  if (app.isReady()) setTimeout(check, 10_000).unref();
  setInterval(check, CHECK_EVERY).unref();
}
