import { describe, expect, it } from "vite-plus/test";
import { loadArrangements, parseArrangements, saveArrangements } from "./studio-store";
import type { SavedArrangements } from "./scene-sources";

function setupStorage() {
  const files = new Map<string, string>();
  const directory = {
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name) && !options?.create) {
        const error = new DOMException("File not found", "NotFoundError");
        throw error;
      }
      return {
        getFile: async () => ({
          text: async () => files.get(name) ?? "",
        }),
        createWritable: async () => {
          let buffer = "";
          return {
            write: async (chunk: string) => {
              buffer += chunk;
            },
            close: async () => {
              files.set(name, buffer);
            },
            abort: async () => {},
          };
        },
      };
    },
  };
  const root = {
    getDirectoryHandle: async (_name: string, _options?: { create?: boolean }) => directory,
  };
  Object.defineProperty(globalThis.navigator, "storage", {
    value: {
      getDirectory: async () => root,
    },
    configurable: true,
  });
  return { files };
}

describe("studio-store arrangements", () => {
  it("returns default arrangements on NotFoundError", async () => {
    setupStorage();
    const result = await loadArrangements("proj-1");
    expect(result).toEqual({
      sourceNumbers: { camera: 0, screen: 0 },
      scenes: {},
    });
  });

  it("saves and loads arrangements", async () => {
    setupStorage();
    const data: SavedArrangements = {
      sourceNumbers: { camera: 2, screen: 1 },
      scenes: {
        "scene-1": [
          {
            identity: "camera:dev-1",
            label: "Camera 1",
            kind: "camera",
            layout: { x: 0.1, y: 0.2, w: 0.3 },
          },
        ],
      },
    };
    await saveArrangements("proj-1", data);
    const loaded = await loadArrangements("proj-1");
    expect(loaded).toEqual(data);
  });

  it("opens a corrupt file as empty arrangements instead of blocking Studio", async () => {
    const { files } = setupStorage();
    files.set("proj-corrupt.arrangements.json", "{ invalid json");
    expect((await loadArrangements("proj-corrupt")).scenes).toEqual({});
  });
});

describe("parseArrangements", () => {
  it("falls back to empty arrangements for a corrupt file", () => {
    expect(parseArrangements("{not json")).toEqual({
      sourceNumbers: { camera: 0, screen: 0 },
      scenes: {},
    });
  });

  it("keeps only well-formed, unique placements", () => {
    const layout = { x: 0.1, y: 0.2, w: 0.3 };
    const parsed = parseArrangements(
      JSON.stringify({
        sourceNumbers: { camera: 2, screen: "x" },
        scenes: {
          one: [
            null,
            { identity: "camera:a", label: "Camera 1", kind: "camera", layout },
            { identity: "camera:a", label: "Duplicate", kind: "camera", layout },
            { identity: "screen:1", kind: "screen", layout: { x: "0", y: 0, w: 1 } },
            { identity: "", kind: "camera", layout },
            { identity: "mic:1", kind: "microphone", layout },
            { identity: "invalid:1", kind: "constructor", layout },
            { identity: "invalid:2", kind: "__proto__", layout },
          ],
          two: "nope",
        },
      }),
    );
    expect(parsed).toEqual({
      sourceNumbers: { camera: 2, screen: 0 },
      scenes: { one: [{ identity: "camera:a", label: "Camera 1", kind: "camera", layout }] },
    });
  });
});
