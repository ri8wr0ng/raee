import { LiveStudio } from "@sidecut/core/live-studio";
import type { SavedArrangements } from "./scene-sources";

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
  const text = await (await handle.getFile()).text();
  const parsed = JSON.parse(text) as SavedArrangements;
  return {
    sourceNumbers: {
      camera: Number(parsed?.sourceNumbers?.camera) || 0,
      screen: Number(parsed?.sourceNumbers?.screen) || 0,
    },
    scenes: parsed?.scenes && typeof parsed.scenes === "object" ? parsed.scenes : {},
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
