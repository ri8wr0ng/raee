import { describe, expect, it } from "vite-plus/test";
import { loadArrangements, saveArrangements } from "./studio-store";
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

  it("throws on corrupt JSON so corrupt file is reported", async () => {
    const { files } = setupStorage();
    files.set("proj-corrupt.arrangements.json", "{ invalid json");
    await expect(loadArrangements("proj-corrupt")).rejects.toThrow();
  });
});
