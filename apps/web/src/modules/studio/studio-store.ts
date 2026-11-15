import { LiveStudio } from "@sidecut/core/live-studio";
import type { Placement, SavedArrangements, SourceKind } from "./scene-sources";

const DIRECTORY = "live-studio";
const fileName = (projectID: string) => `${encodeURIComponent(projectID)}.json`;
const arrangementsFileName = (projectID: string) =>
  `${encodeURIComponent(projectID)}.arrangements.json`;

/** Scenes live beside the project in origin-private storage. A corrupt file is reported, not replaced. */
export async function loadStudio(projectID: string) {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
  let handle: FileSystemFileHandle;
  try {
    handle = await directory.getFileHandle(fileName(projectID));
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return new LiveStudio();
    throw error;
  }
  return LiveStudio.restore(await (await handle.getFile()).text());
}

export async function saveStudio(projectID: string, studio: LiveStudio) {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
  const handle = await directory.getFileHandle(fileName(projectID), { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(studio.serialize());
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

/** Source placements and label counters per scene live beside the studio file. */
export async function loadArrangements(projectID: string): Promise<SavedArrangements> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
  let handle: FileSystemFileHandle;
  try {
    handle = await directory.getFileHandle(arrangementsFileName(projectID));
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return { sourceNumbers: { camera: 0, screen: 0 }, scenes: {} };
    }
    throw error;
  }
  return parseArrangements(await (await handle.getFile()).text());
}

const KIND_NAMES: Record<SourceKind, string> = {
  camera: "Camera",
  screen: "Screen",
  video: "Video",
  audio: "Audio",
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Reads saved arrangements, keeping only well-formed placements. Arrangements are a
 * convenience, so a corrupt file falls back to empty instead of blocking Studio.
 */
export function parseArrangements(text: string): SavedArrangements {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const numbers = (root.sourceNumbers ?? {}) as Record<string, unknown>;
  const count = (value: unknown) => (finite(value) && value >= 0 ? Math.floor(value) : 0);
  const scenes: SavedArrangements["scenes"] = {};
  const rawScenes = root.scenes && typeof root.scenes === "object" ? root.scenes : {};
  for (const [scene, list] of Object.entries(rawScenes as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const placements: Placement[] = [];
    for (const item of list as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const { identity, label, kind, layout, deviceId, mediaId } = item as Record<string, unknown>;
      const box = (layout ?? {}) as Record<string, unknown>;
      if (typeof identity !== "string" || !identity || seen.has(identity)) continue;
      if (typeof kind !== "string" || !(kind in KIND_NAMES)) continue;
      const sourceKind = kind as SourceKind;
      if (sourceKind === "video" && (typeof mediaId !== "string" || !mediaId)) continue;
      if (!finite(box.x) || !finite(box.y) || !finite(box.w) || box.w <= 0) continue;
      seen.add(identity);
      placements.push({
        identity,
        label: typeof label === "string" && label ? label : KIND_NAMES[sourceKind],
        kind: sourceKind,
        layout: { x: box.x, y: box.y, w: box.w },
        ...(typeof deviceId === "string" && deviceId ? { deviceId } : {}),
        ...(typeof mediaId === "string" && mediaId ? { mediaId } : {}),
      });
    }
    if (placements.length) scenes[scene] = placements;
  }
  return {
    sourceNumbers: { camera: count(numbers.camera), screen: count(numbers.screen) },
    scenes,
  };
}

export async function saveArrangements(
  projectID: string,
  arrangements: SavedArrangements,
): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
  const handle = await directory.getFileHandle(arrangementsFileName(projectID), { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(arrangements, null, 2));
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}
