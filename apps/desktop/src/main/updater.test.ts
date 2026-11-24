import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vite-plus/test";
import type { UpdateState } from "@raee/contracts/desktop";
import { createUpdateController, type Updater } from "./updater.ts";

function fakeUpdater() {
  const events = new EventEmitter();
  const updater = Object.assign(events, {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => {
      events.emit("checking-for-update");
      events.emit("update-available", { version: "0.0.2" });
    }),
    downloadUpdate: vi.fn(async () => {
      events.emit("download-progress", { percent: 41.6 });
      events.emit("update-downloaded", { version: "0.0.2" });
    }),
    quitAndInstall: vi.fn(),
  });
  return updater as typeof updater & Updater;
}

describe("update controller", () => {
  it("checks, downloads with progress and installs silently on restart", async () => {
    const updater = fakeUpdater();
    const states: UpdateState[] = [];
    const controller = createUpdateController(updater, {
      manualInstall: false,
      openRelease: vi.fn(),
      publish: (state) => states.push(state),
    });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    controller.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await controller.check();
    await controller.download();
    controller.install();
    expect(states).toEqual([
      { status: "checking" },
      { status: "available", version: "0.0.2", manual: false },
      { status: "downloading", version: "0.0.2", percent: 0 },
      { status: "downloading", version: "0.0.2", percent: 42 },
      { status: "ready", version: "0.0.2" },
    ]);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it("opens the release page instead of downloading when it cannot install in place", async () => {
    const updater = fakeUpdater();
    const openRelease = vi.fn(async () => {});
    const controller = createUpdateController(updater, {
      manualInstall: true,
      openRelease,
      publish: () => {},
    });
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await controller.check();
    expect(controller.state()).toEqual({ status: "available", version: "0.0.2", manual: true });
    await controller.download();
    expect(openRelease).toHaveBeenCalledWith("0.0.2");
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("reports failures without throwing and does not re-check mid-download", async () => {
    const updater = fakeUpdater();
    const controller = createUpdateController(updater, {
      manualInstall: false,
      openRelease: vi.fn(),
      publish: () => {},
    });
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit("error", new Error("offline\nstack"));
      throw new Error("offline");
    });
    await controller.check();
    expect(controller.state()).toEqual({ status: "error", message: "offline" });
    await controller.check();
    updater.downloadUpdate.mockImplementationOnce(() => new Promise(() => {}));
    void controller.download();
    await controller.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(controller.state().status).toBe("downloading");
  });
});
