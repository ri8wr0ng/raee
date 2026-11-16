import type { UpdateState } from "@sidecut/contracts/desktop";

type Info = { version: string };

export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available" | "update-downloaded", listener: (info: Info) => void): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export function createUpdateController(
  updater: Updater,
  options: {
    /** Install in place is impossible (unsigned macOS), so the release page is opened instead. */
    manualInstall: boolean;
    openRelease: (version: string) => Promise<void>;
    publish: (state: UpdateState) => void;
  },
) {
  let state: UpdateState = { status: "idle" };
  const set = (next: UpdateState) => {
    state = next;
    options.publish(next);
  };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = !options.manualInstall;
  updater.on("checking-for-update", () => set({ status: "checking" }));
  updater.on("update-available", (info) =>
    set({ status: "available", version: info.version, manual: options.manualInstall }),
  );
  updater.on("update-not-available", () => set({ status: "current" }));
  updater.on("download-progress", (progress) => {
    if (state.status === "downloading")
      set({ ...state, percent: Math.min(100, Math.max(0, Math.round(progress.percent))) });
  });
  updater.on("update-downloaded", (info) => set({ status: "ready", version: info.version }));
  updater.on("error", (error) =>
    set({ status: "error", message: error.message.split("\n")[0]!.trim() }),
  );
  return {
    state: () => state,
    async check() {
      if (state.status === "checking" || state.status === "downloading" || state.status === "ready")
        return;
      await updater.checkForUpdates().catch(() => {});
    },
    async download() {
      if (state.status !== "available") return;
      if (options.manualInstall) return options.openRelease(state.version);
      set({ status: "downloading", version: state.version, percent: 0 });
      await updater.downloadUpdate().catch(() => {});
    },
    install() {
      if (state.status === "ready") updater.quitAndInstall(true, true);
    },
  };
}
