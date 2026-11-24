export const rendererScheme = "sidecut";
export const rendererHost = "app";
export const rendererOrigin = `${rendererScheme}://${rendererHost}`;

export const bridgeChannels = {
  supportReport: "raee:support-report",
  deliveryEncode: "raee:delivery-encode",
  deliveryCancel: "raee:delivery-cancel",
  nativeRecordingDevices: "raee:native-recording-devices",
  nativeRecordingStart: "raee:native-recording-start",
  nativeRecordingStop: "raee:native-recording-stop",
  nativeRecordingList: "raee:native-recording-list",
  nativeRecordingStreamStatus: "raee:native-recording-stream-status",
  nativeRecordingRetry: "raee:native-recording-retry",
  nativeRecordingPoster: "raee:native-recording-poster",
  nativeRecordingAdopt: "raee:native-recording-adopt",
  nativeRecordingRead: "raee:native-recording-read",
  nativeRecordingDelete: "raee:native-recording-delete",
  nativeRecordingReveal: "raee:native-recording-reveal",
  capturePrepare: "raee:capture-prepare",
  captureRelease: "raee:capture-release",
  captureSources: "raee:capture-sources",
  recordingDirectory: "raee:recording-directory",
  recordingExport: "raee:recording-export",
  storageRequest: "raee:storage-request",
  storagePutFile: "raee:storage-put-file",
  storageGetFile: "raee:storage-get-file",
  storageFileBegin: "raee:storage-file-begin",
  storageFileAppend: "raee:storage-file-append",
  storageFileSeal: "raee:storage-file-seal",
  storageFileAbort: "raee:storage-file-abort",
  storageFileSize: "raee:storage-file-size",
  storageFileRead: "raee:storage-file-read",
  storageFileDigest: "raee:storage-file-digest",
  storageRemoveFile: "raee:storage-remove-file",
  serviceReady: "raee:service-ready",
  serviceProgress: "raee:service-progress",
  serviceJobs: "raee:service-jobs",
  serviceRequest: "raee:service-request",
  serviceReply: "raee:service-reply",
  appInfo: "raee:app-info",
  projectRequest: "raee:project-request",
  projectResource: "raee:project-resource",
  projectChanged: "raee:project-changed",
  projectFlush: "raee:project-flush",
  projectImport: "raee:project-import",
  projectReload: "raee:project-reload",
  folderSelect: "raee:folder-select",
  folderChanged: "raee:folder-changed",
  nativeMedia: "raee:native-media",
  nativeCancel: "raee:native-cancel",
  nativeProgress: "raee:native-progress",
  providerCall: "raee:provider-call",
  providerCancel: "raee:provider-cancel",
  providerCredential: "raee:provider-credential",
  assistantConnect: "raee:assistant-connect",
  assistantSettings: "raee:assistant-settings",
  assistantConfigure: "raee:assistant-configure",
  kickChannelLookup: "raee:kick-channel-lookup",
  updateState: "raee:update-state",
  updateChanged: "raee:update-changed",
  updateCheck: "raee:update-check",
  updateDownload: "raee:update-download",
  updateInstall: "raee:update-install",
} as const;

export type DesktopAppInfo = {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly versions: { readonly electron: string; readonly chrome: string };
};

export type DesktopBridge = NativeBridge & {
  readonly getAppInfo: () => Promise<DesktopAppInfo>;
  readonly providerCall: (requestID: string, request: unknown) => Promise<unknown>;
  readonly providerCancel: (requestID: string) => Promise<void>;
  readonly providerCredential: (
    provider: string,
    action: "set" | "clear",
    secret?: string,
  ) => Promise<void>;
  /** Start the built-in assistant if needed and return how the renderer reaches it. */
  readonly assistantConnect?: () => Promise<AssistantConnection>;
  /** The assistant's configured provider and model, and which providers have a saved key. */
  readonly assistantSettings?: () => Promise<AssistantSettings>;
  /** Save the provider and model the user chose for the assistant. */
  readonly assistantConfigure?: (settings: { provider: string; model: string }) => Promise<void>;
  readonly kickChannelLookup?: (
    slug: string,
  ) => Promise<{ chatroomId: number; channelSlug: string }>;
};
import type { NativeBridge } from "@raee/contracts/desktop";

export type AssistantConnection =
  | { status: "ready"; baseUrl: string; token: string; provider: string; model: string }
  | { status: "needs-setup" }
  | { status: "unavailable"; message: string };

export type AssistantSettings = {
  readonly provider: string | null;
  readonly model: string | null;
  readonly keys: string[];
};
