// Saves an editor project to the cloud and opens it again.
//
// Framework-free: every backend call is injected. `client`/`save` talk to Convex elsewhere,
// `upload` defaults to uploadToCloud (multipart into storage) and `resolve`/`download` handle
// opening. Footage listed in project.mediaIDs stays visible in the library; everything else the
// project needs (LUTs, project document) is uploaded hidden.

import { downloadToFile } from "./add-to-project";
import { uploadToCloud, type UploadClient, type UploadInput } from "./upload";

export type CloudResource = {
  key: string;
  name: string;
  type: string;
  bytes: number;
  mediaId: string;
  versionId: string;
};

export type CloudProjectRecord = {
  _id: string;
  name: string;
  revision: number;
  document: { mediaId: string; versionId: string };
  resources: CloudResource[];
};

export type LocalProject = {
  projectID: string;
  name: string;
  json: string;
  mediaIDs: string[];
  resources: { key: string; file: File }[];
};

export type SaveProgress = { loaded: number; total: number; file: string };

type SaveArgs = {
  teamId: string;
  projectId?: string;
  baseRevision?: number;
  name: string;
  document: { mediaId: string; versionId: string };
  resources: CloudResource[];
};

type SaveResult = { projectId: string; revision: number };

const footageType = /^(video|audio|image)\//;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 ._-]/g, "_") || "project";
}

// Uploads every changed resource plus the project document, then records the result through `save`.
// Unchanged resources (same key, name, type and size) are reused without an upload. The document is
// always uploaded as a new version of the existing document media, when there is one.
export async function saveProjectToCloud(options: {
  project: LocalProject;
  teamId: string;
  existing: CloudProjectRecord | null;
  client: UploadClient;
  save(args: SaveArgs): Promise<SaveResult>;
  upload?: typeof uploadToCloud;
  onProgress?: (p: SaveProgress) => void;
  signal?: AbortSignal;
}): Promise<{ projectId: string; revision: number; uploaded: number; reused: number }> {
  const { project, teamId, existing, client, save, signal, onProgress } = options;
  const upload = options.upload ?? uploadToCloud;
  const mediaIDs = new Set(project.mediaIDs);
  const previous = new Map(existing?.resources.map((entry) => [entry.key, entry]) ?? []);

  const documentFile = new File([project.json], `${safeFileName(project.name)}.tandem`, {
    type: "application/json",
  });

  const planned = project.resources.map(({ key, file }) => {
    const prev = previous.get(key);
    const reuse =
      prev !== undefined &&
      prev.bytes === file.size &&
      prev.name === file.name &&
      prev.type === file.type;
    return { key, file, prev, reuse };
  });

  const total =
    planned.reduce((sum, entry) => sum + (entry.reuse ? 0 : entry.file.size), 0) +
    documentFile.size;
  let loaded = 0;
  const report = (file: string, bytes: number) => onProgress?.({ loaded: bytes, total, file });

  const resources: CloudResource[] = [];
  let uploaded = 0;
  let reused = 0;

  for (const { key, file, prev, reuse } of planned) {
    signal?.throwIfAborted();
    if (reuse && prev) {
      reused += 1;
      resources.push({
        key,
        name: file.name,
        type: file.type,
        bytes: file.size,
        mediaId: prev.mediaId,
        versionId: prev.versionId,
      });
      continue;
    }
    const footage = mediaIDs.has(key) && footageType.test(file.type);
    const name = footage ? file.name : `${project.name} · ${file.name}`.slice(0, 200);
    const input: UploadInput = {
      file,
      name,
      teamId,
      client,
      storage: null,
      onProgress: (p) => report(file.name, loaded + p.loaded),
      ...(signal ? { cancelSignal: signal } : {}),
      ...(prev ? { mediaId: prev.mediaId } : {}),
      ...(footage ? {} : { hidden: true }),
    };
    const result = await upload(input);
    uploaded += 1;
    loaded += file.size;
    report(file.name, loaded);
    resources.push({
      key,
      name: file.name,
      type: file.type,
      bytes: file.size,
      mediaId: result.mediaId,
      versionId: result.versionId,
    });
  }

  signal?.throwIfAborted();
  const document = await upload({
    file: documentFile,
    name: `${project.name} · project`,
    teamId,
    client,
    storage: null,
    hidden: true,
    onProgress: (p) => report(documentFile.name, loaded + p.loaded),
    ...(signal ? { cancelSignal: signal } : {}),
    ...(existing ? { mediaId: existing.document.mediaId } : {}),
  });
  loaded += documentFile.size;
  report(documentFile.name, loaded);

  signal?.throwIfAborted();
  const saved = await save({
    teamId,
    name: project.name,
    document: { mediaId: document.mediaId, versionId: document.versionId },
    resources,
    ...(existing ? { projectId: existing._id, baseRevision: existing.revision } : {}),
  });

  return { projectId: saved.projectId, revision: saved.revision, uploaded, reused };
}

// Downloads the project document and every resource, one at a time.
export async function openCloudProject(options: {
  record: CloudProjectRecord;
  resolve(args: { mediaId: string; versionId: string }): Promise<{ url: string }>;
  download?: typeof downloadToFile;
  onProgress?: (p: SaveProgress) => void;
  signal?: AbortSignal;
}): Promise<{ json: string; resources: { key: string; file: File }[] }> {
  const { record, resolve, signal, onProgress } = options;
  const download = options.download ?? downloadToFile;

  signal?.throwIfAborted();
  const documentUrl = (
    await resolve({
      mediaId: record.document.mediaId,
      versionId: record.document.versionId,
    })
  ).url;
  signal?.throwIfAborted();
  const documentFile = await download({
    url: documentUrl,
    name: "project",
    fileName: "project.tandem",
    mimeType: "application/json",
    ...(signal ? { signal } : {}),
  });
  const json = await documentFile.text();

  const total = record.resources.reduce((sum, entry) => sum + entry.bytes, 0);
  let loaded = 0;
  const resources: { key: string; file: File }[] = [];

  for (const entry of record.resources) {
    signal?.throwIfAborted();
    const { url } = await resolve({ mediaId: entry.mediaId, versionId: entry.versionId });
    const file = await download({
      url,
      name: entry.name,
      fileName: entry.name,
      ...(entry.type ? { mimeType: entry.type } : {}),
      ...(signal ? { signal } : {}),
      onProgress: (p) => onProgress?.({ loaded: loaded + p.loaded, total, file: entry.name }),
    });
    if (file.size !== entry.bytes) {
      throw new Error(`${entry.name} did not download completely. Try again.`);
    }
    loaded += entry.bytes;
    onProgress?.({ loaded, total, file: entry.name });
    resources.push({ key: entry.key, file });
  }

  return { json, resources };
}

// `revision` is the cloud revision this device last saved or opened, used to catch saves made elsewhere.
export type ProjectLink = { projectId: string; teamId: string; revision?: number };

const linkPrefix = "raee.cloud.project.";

function linkStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

// Reads the cloud project a local project was last saved to or opened from. Returns null when
// nothing is stored, the JSON is broken or the shape is wrong.
export function readProjectLink(
  localProjectID: string,
  storage?: Pick<Storage, "getItem">,
): ProjectLink | null {
  const store = storage ?? linkStorage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(linkPrefix + localProjectID);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { projectId, teamId, revision } = value as Record<string, unknown>;
    if (typeof projectId !== "string" || typeof teamId !== "string") return null;
    return Number.isSafeInteger(revision)
      ? { projectId, teamId, revision: revision as number }
      : { projectId, teamId };
  } catch {
    return null;
  }
}

export function writeProjectLink(
  localProjectID: string,
  link: ProjectLink,
  storage?: Pick<Storage, "setItem">,
): void {
  const store = storage ?? linkStorage();
  if (!store) return;
  try {
    store.setItem(linkPrefix + localProjectID, JSON.stringify(link));
  } catch {
    // Storage is full or blocked: the link is a convenience, not required for saving.
  }
}
