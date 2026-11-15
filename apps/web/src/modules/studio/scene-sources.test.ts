import { describe, expect, it } from "vite-plus/test";
import { SceneSources, type SavedPlacement } from "./scene-sources";

const at = (x: number) => ({ x, y: 0, w: 0.5 });

describe("scene sources", () => {
  it("keeps each scene's sources and positions apart", () => {
    const scenes = new SceneSources();
    scenes.add("one", { sourceId: "camera", layout: at(0) });
    scenes.add("one", { sourceId: "screen", layout: at(0) }, 0);
    scenes.copy("one", "two");
    scenes.place("two", "camera", at(0.5));
    scenes.remove("two", "screen");

    expect(scenes.of("one")).toEqual([
      { sourceId: "screen", layout: at(0) },
      { sourceId: "camera", layout: at(0) },
    ]);
    expect(scenes.of("two")).toEqual([{ sourceId: "camera", layout: at(0.5) }]);
  });

  it("restacks within one scene only", () => {
    const scenes = new SceneSources();
    scenes.add("one", { sourceId: "a", layout: at(0) });
    scenes.add("one", { sourceId: "b", layout: at(0) });
    scenes.copy("one", "two");
    scenes.restack("one", "a", 1);
    expect(scenes.of("one").map((item) => item.sourceId)).toEqual(["b", "a"]);
    expect(scenes.of("two").map((item) => item.sourceId)).toEqual(["a", "b"]);
  });

  it("reports when a source is no longer shown anywhere", () => {
    const scenes = new SceneSources();
    scenes.add("one", { sourceId: "camera", layout: at(0) });
    scenes.add("two", { sourceId: "camera", layout: at(0) });
    scenes.add("two", { sourceId: "screen", layout: at(0) });
    expect(scenes.remove("one", "camera")).toBe(false);
    expect(scenes.drop("two")).toEqual(["camera", "screen"]);
    scenes.add("one", { sourceId: "camera", layout: at(0) });
    scenes.forget("camera");
    expect(scenes.used("camera")).toBe(false);
  });

  it("serializes and restores scene arrangements with stable identities", () => {
    const scenes = new SceneSources();
    const camPlacement: SavedPlacement = {
      identity: "camera:device-1",
      label: "Camera 1",
      kind: "camera",
      layout: at(0.1),
      deviceId: "device-1",
    };
    const screenPlacement: SavedPlacement = {
      identity: "screen:1",
      label: "Screen 1",
      kind: "screen",
      layout: at(0.5),
    };

    scenes.add("scene-a", camPlacement);
    scenes.add("scene-a", screenPlacement);
    scenes.add("scene-b", { ...camPlacement, layout: at(0.8) });

    const serialized = scenes.serialize();
    expect(serialized).toEqual({
      "scene-a": [camPlacement, screenPlacement],
      "scene-b": [{ ...camPlacement, layout: at(0.8) }],
    });

    const restored = new SceneSources();
    restored.restore(serialized);
    expect(restored.of("scene-a")).toEqual([camPlacement, screenPlacement]);
    expect(restored.of("scene-b")).toEqual([{ ...camPlacement, layout: at(0.8) }]);
  });

  it("identifies missing sources when live sources are not connected", () => {
    const scenes = new SceneSources();
    scenes.restore({
      "scene-1": [
        { identity: "camera:device-1", label: "Camera 1", kind: "camera", layout: at(0) },
        { identity: "screen:1", label: "Screen 1", kind: "screen", layout: at(0.5) },
      ],
    });

    // None connected
    expect(scenes.missing("scene-1", [])).toEqual([
      { identity: "camera:device-1", label: "Camera 1", kind: "camera", layout: at(0) },
      { identity: "screen:1", label: "Screen 1", kind: "screen", layout: at(0.5) },
    ]);

    // Camera connected, screen missing
    expect(scenes.missing("scene-1", ["camera:device-1"])).toEqual([
      { identity: "screen:1", label: "Screen 1", kind: "screen", layout: at(0.5) },
    ]);

    // Both connected
    expect(scenes.missing("scene-1", ["camera:device-1", "screen:1"])).toEqual([]);
  });

  it("finds all scenes containing a source identity and updates identity on device switch", () => {
    const scenes = new SceneSources();
    scenes.add("scene-1", {
      identity: "camera:cam-a",
      label: "Camera 1",
      kind: "camera",
      layout: at(0),
      deviceId: "cam-a",
    });
    scenes.add("scene-2", {
      identity: "camera:cam-a",
      label: "Camera 1",
      kind: "camera",
      layout: at(0.5),
      deviceId: "cam-a",
    });

    expect(scenes.scenesWith("camera:cam-a")).toEqual(["scene-1", "scene-2"]);

    scenes.updateIdentity("camera:cam-a", "camera:cam-b", "cam-b");
    expect(scenes.scenesWith("camera:cam-a")).toEqual([]);
    expect(scenes.scenesWith("camera:cam-b")).toEqual(["scene-1", "scene-2"]);
    expect(scenes.of("scene-1")[0]?.identity).toBe("camera:cam-b");
    expect(scenes.of("scene-1")[0]?.deviceId).toBe("cam-b");
    expect(scenes.of("scene-2")[0]?.layout).toEqual(at(0.5));
  });
});
