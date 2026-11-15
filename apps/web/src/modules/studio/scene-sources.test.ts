import { describe, expect, it } from "vite-plus/test";
import { SceneSources, type Placement } from "./scene-sources";

const at = (x: number) => ({ x, y: 0, w: 0.5 });
const camera = (identity: string, x = 0): Placement => ({
  identity,
  label: "Camera 1",
  kind: "camera",
  layout: at(x),
});
const screen = (identity: string, x = 0): Placement => ({
  identity,
  label: "Screen 1",
  kind: "screen",
  layout: at(x),
});
const ids = (list: readonly Placement[]) => list.map((item) => item.identity);

describe("scene sources", () => {
  it("keeps each scene's sources and positions apart", () => {
    const scenes = new SceneSources();
    scenes.add("one", camera("camera"));
    scenes.add("one", screen("screen"), 0);
    scenes.copy("one", "two");
    scenes.place("two", "camera", at(0.5));
    scenes.remove("two", "screen");

    expect(scenes.of("one")).toEqual([screen("screen"), camera("camera")]);
    expect(scenes.of("two")).toEqual([camera("camera", 0.5)]);
  });

  it("restacks within one scene only", () => {
    const scenes = new SceneSources();
    scenes.add("one", camera("a"));
    scenes.add("one", camera("b"));
    scenes.copy("one", "two");
    scenes.restack("one", "a", 1);
    expect(ids(scenes.of("one"))).toEqual(["b", "a"]);
    expect(ids(scenes.of("two"))).toEqual(["a", "b"]);
  });

  it("reports when a source is no longer placed anywhere", () => {
    const scenes = new SceneSources();
    scenes.add("one", camera("camera"));
    scenes.add("two", camera("camera"));
    scenes.add("two", screen("screen"));
    expect(scenes.remove("one", "camera")).toBe(false);
    expect(scenes.drop("two")).toEqual(["camera", "screen"]);
    scenes.add("one", camera("camera"));
    scenes.forget("camera");
    expect(scenes.used("camera")).toBe(false);
  });

  it("serializes and restores without sharing layouts", () => {
    const scenes = new SceneSources();
    scenes.add("a", { ...camera("camera:device-1", 0.1), deviceId: "device-1" });
    scenes.add("a", screen("screen:1", 0.5));
    scenes.add("b", camera("camera:device-1", 0.8));
    scenes.add("empty", camera("x"));
    scenes.remove("empty", "x");

    const saved = scenes.serialize();
    expect(Object.keys(saved)).toEqual(["a", "b"]);
    const restored = new SceneSources();
    restored.restore(saved);
    expect(restored.of("a")).toEqual(saved.a);
    restored.place("a", "screen:1", at(0.9));
    expect(saved.a![1]!.layout).toEqual(at(0.5));
  });

  it("re-keys a source in every scene when its camera changes", () => {
    const scenes = new SceneSources();
    scenes.add("one", { ...camera("camera:cam-a"), deviceId: "cam-a" });
    scenes.add("two", { ...camera("camera:cam-a", 0.5), deviceId: "cam-a" });
    expect(scenes.scenesWith("camera:cam-a")).toEqual(["one", "two"]);

    scenes.updateIdentity("camera:cam-a", "camera:cam-b", "cam-b");
    expect(scenes.scenesWith("camera:cam-a")).toEqual([]);
    expect(scenes.scenesWith("camera:cam-b")).toEqual(["one", "two"]);
    expect(scenes.of("one")[0]?.deviceId).toBe("cam-b");
    expect(scenes.of("two")[0]?.layout).toEqual(at(0.5));
  });
});
