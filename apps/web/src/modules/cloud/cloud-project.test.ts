import { expect, it } from "vite-plus/test";
import type { DownloadOptions } from "./add-to-project";
import {
  openCloudProject,
  readProjectLink,
  saveProjectToCloud,
  writeProjectLink,
  type CloudProjectRecord,
  type CloudResource,
  type LocalProject,
  type SaveProgress,
} from "./cloud-project";
import type { UploadClient, UploadInput } from "./upload";

// Fake multipart upload: reports progress in two steps and returns a fresh version per call.
function fakeUpload(onCall?: (input: UploadInput, index: number) => void) {
  const calls: UploadInput[] = [];
  const upload = async (input: UploadInput) => {
    calls.push(input);
    onCall?.(input, calls.length - 1);
    input.onProgress?.({ loaded: Math.floor(input.file.size / 2), total: input.file.size });
    input.onProgress?.({ loaded: input.file.size, total: input.file.size });
    return { mediaId: `media_${calls.length}`, versionId: `version_${calls.length}` };
  };
  return { upload, calls };
}

const client = {} as UploadClient;

function footageFile(name = "clip.mp4", bytes = 10) {
  return new File([new Uint8Array(bytes)], name, { type: "video/mp4" });
}

function lutFile(name = "a.cube", bytes = 20) {
  return new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });
}

function project(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    projectID: "local_1",
    name: "Demo",
    json: '{"version":1}',
    mediaIDs: ["clip"],
    resources: [
      { key: "clip", file: footageFile() },
      { key: "lut:a.cube", file: lutFile() },
    ],
    ...overrides,
  };
}

function existingRecord(overrides: Partial<CloudProjectRecord> = {}): CloudProjectRecord {
  return {
    _id: "cloud_1",
    name: "Demo",
    revision: 7,
    document: { mediaId: "doc_media", versionId: "doc_v1" },
    resources: [],
    ...overrides,
  };
}

it("uploads every file of a new project: footage visible, LUT and document hidden", async () => {
  const { upload, calls } = fakeUpload();
  const saves: Parameters<Parameters<typeof saveProjectToCloud>[0]["save"]>[0][] = [];

  const result = await saveProjectToCloud({
    project: project(),
    teamId: "team_1",
    existing: null,
    client,
    upload: upload,
    save: async (args) => {
      saves.push(args);
      return { projectId: "proj_1", revision: 1 };
    },
  });

  expect(result).toEqual({ projectId: "proj_1", revision: 1, uploaded: 2, reused: 0 });
  expect(calls).toHaveLength(3);

  const [clip, lut, doc] = calls;
  expect(clip?.name).toBe("clip.mp4");
  expect(clip).not.toHaveProperty("hidden");
  expect(clip).not.toHaveProperty("mediaId");
  expect(lut?.name).toBe("Demo · a.cube");
  expect(lut).toMatchObject({ hidden: true });
  expect(doc?.name).toBe("Demo · project");
  expect(doc).toMatchObject({ hidden: true });
  expect(doc?.file).toBeInstanceOf(File);
  expect((doc!.file as File).name).toBe("Demo.tandem");
  expect((doc!.file as File).type).toBe("application/json");

  expect(saves).toHaveLength(1);
  const save = saves[0];
  expect(save).toMatchObject({
    teamId: "team_1",
    name: "Demo",
    document: { mediaId: "media_3", versionId: "version_3" },
  });
  expect(save).not.toHaveProperty("projectId");
  expect(save?.resources).toEqual([
    {
      key: "clip",
      name: "clip.mp4",
      type: "video/mp4",
      bytes: 10,
      mediaId: "media_1",
      versionId: "version_1",
    },
    {
      key: "lut:a.cube",
      name: "a.cube",
      type: "application/octet-stream",
      bytes: 20,
      mediaId: "media_2",
      versionId: "version_2",
    },
  ]);
});

it("reuses unchanged resources and uploads changed ones as new versions on re-save", async () => {
  const { upload, calls } = fakeUpload();
  const saves: Parameters<Parameters<typeof saveProjectToCloud>[0]["save"]>[0][] = [];
  const clipResource: CloudResource = {
    key: "clip",
    name: "clip.mp4",
    type: "video/mp4",
    bytes: 10,
    mediaId: "clip_media",
    versionId: "clip_v1",
  };
  const lutResource: CloudResource = {
    key: "lut:a.cube",
    name: "a.cube",
    type: "application/octet-stream",
    bytes: 5,
    mediaId: "lut_media",
    versionId: "lut_v1",
  };

  const result = await saveProjectToCloud({
    project: project(),
    teamId: "team_1",
    existing: existingRecord({ resources: [clipResource, lutResource] }),
    client,
    upload: upload,
    save: async (args) => {
      saves.push(args);
      return { projectId: "cloud_1", revision: 8 };
    },
  });

  expect(result).toEqual({ projectId: "cloud_1", revision: 8, uploaded: 1, reused: 1 });
  // clip is reused; lut changed size so it uploads; the document always uploads.
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ mediaId: "lut_media", hidden: true });
  expect(calls[1]).toMatchObject({ mediaId: "doc_media", hidden: true });

  const save = saves[0];
  expect(save).toMatchObject({ projectId: "cloud_1", baseRevision: 7 });
  expect(save?.document).toEqual({ mediaId: "media_2", versionId: "version_2" });
  expect(save?.resources).toEqual([
    { ...clipResource, bytes: 10 },
    {
      key: "lut:a.cube",
      name: "a.cube",
      type: "application/octet-stream",
      bytes: 20,
      mediaId: "media_1",
      versionId: "version_1",
    },
  ]);
});

it("reports monotonic progress that ends at the total", async () => {
  const { upload } = fakeUpload();
  const progress: SaveProgress[] = [];
  const json = '{"version":1}';
  const docBytes = new Blob([json]).size;
  const total = 10 + 20 + docBytes;

  await saveProjectToCloud({
    project: project({ json }),
    teamId: "team_1",
    existing: null,
    client,
    upload: upload,
    onProgress: (p) => progress.push(p),
    save: async () => ({ projectId: "proj_1", revision: 1 }),
  });

  expect(progress.length).toBeGreaterThan(0);
  for (const p of progress) expect(p.total).toBe(total);
  for (let i = 1; i < progress.length; i++) {
    expect(progress[i]!.loaded).toBeGreaterThanOrEqual(progress[i - 1]!.loaded);
  }
  expect(progress.at(-1)).toEqual({ loaded: total, total, file: "Demo.tandem" });
});

it("stops before the document and save when the signal aborts mid-save", async () => {
  const controller = new AbortController();
  const { upload, calls } = fakeUpload(() => controller.abort());
  const saves: unknown[] = [];

  await expect(
    saveProjectToCloud({
      project: project(),
      teamId: "team_1",
      existing: null,
      client,
      upload: upload,
      signal: controller.signal,
      save: async (args) => {
        saves.push(args);
        return { projectId: "proj_1", revision: 1 };
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });

  // Only the first resource was attempted; the loop, document and save never ran.
  expect(calls).toHaveLength(1);
  expect(saves).toEqual([]);
});

function cloudRecord(overrides: Partial<CloudProjectRecord> = {}): CloudProjectRecord {
  return existingRecord({
    document: { mediaId: "doc_media", versionId: "doc_v1" },
    resources: [
      {
        key: "clip",
        name: "clip.mp4",
        type: "video/mp4",
        bytes: 10,
        mediaId: "clip_media",
        versionId: "clip_v1",
      },
      {
        key: "lut:a.cube",
        name: "a.cube",
        type: "application/octet-stream",
        bytes: 20,
        mediaId: "lut_media",
        versionId: "lut_v1",
      },
    ],
    ...overrides,
  });
}

it("opens a cloud project: document json plus one File per resource", async () => {
  const json = '{"version":1,"name":"Demo"}';
  const resolved: { mediaId: string; versionId: string }[] = [];
  const downloaded: DownloadOptions[] = [];
  const bodies = new Map<string, string>([
    ["doc_media", json],
    ["clip_media", "x".repeat(10)],
    ["lut_media", "y".repeat(20)],
  ]);

  const result = await openCloudProject({
    record: cloudRecord(),
    resolve: async (args) => {
      resolved.push(args);
      return { url: `https://files.test/${args.mediaId}` };
    },
    download: async (options) => {
      downloaded.push(options);
      const mediaId = options.url.split("/").pop()!;
      const body = bodies.get(mediaId) ?? "";
      return new File([body], options.fileName ?? "file", {
        ...(options.mimeType ? { type: options.mimeType } : {}),
      });
    },
  });

  expect(result.json).toBe(json);
  expect(result.resources.map((r) => r.key)).toEqual(["clip", "lut:a.cube"]);
  expect(result.resources[0]?.file.name).toBe("clip.mp4");
  expect(result.resources[0]?.file.size).toBe(10);
  expect(result.resources[1]?.file.name).toBe("a.cube");

  expect(resolved).toEqual([
    { mediaId: "doc_media", versionId: "doc_v1" },
    { mediaId: "clip_media", versionId: "clip_v1" },
    { mediaId: "lut_media", versionId: "lut_v1" },
  ]);
  expect(downloaded[0]).toMatchObject({
    name: "project",
    fileName: "project.tandem",
    mimeType: "application/json",
  });
  expect(downloaded[1]).toMatchObject({
    name: "clip.mp4",
    fileName: "clip.mp4",
    mimeType: "video/mp4",
  });
});

it("throws when a downloaded resource size does not match the record", async () => {
  await expect(
    openCloudProject({
      record: cloudRecord({
        resources: [
          {
            key: "clip",
            name: "clip.mp4",
            type: "video/mp4",
            bytes: 10,
            mediaId: "clip_media",
            versionId: "clip_v1",
          },
        ],
      }),
      resolve: async () => ({ url: "https://files.test/x" }),
      download: async (options) =>
        new File(
          [options.fileName === "project.tandem" ? '{"version":1}' : "short"],
          options.fileName ?? "file",
        ),
    }),
  ).rejects.toThrow("clip.mp4 did not download completely. Try again.");
});

class MemoryStorage {
  private readonly items = new Map<string, string>();

  getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.items.set(key, value);
  }

  removeItem(key: string) {
    this.items.delete(key);
  }
}

it("round-trips a project link through storage and survives invalid JSON", () => {
  const storage = new MemoryStorage();
  const link = { projectId: "cloud_1", teamId: "team_1" };

  expect(readProjectLink("local_1", storage)).toBeNull();

  writeProjectLink("local_1", link, storage);
  expect(readProjectLink("local_1", storage)).toEqual(link);
  // A different local project has its own key.
  expect(readProjectLink("local_2", storage)).toBeNull();

  storage.setItem("raee.cloud.project.local_3", "{not json");
  expect(readProjectLink("local_3", storage)).toBeNull();
  storage.setItem("raee.cloud.project.local_4", JSON.stringify({ projectId: 1 }));
  expect(readProjectLink("local_4", storage)).toBeNull();
});
