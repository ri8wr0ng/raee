import { describe, expect, it } from "vite-plus/test";
import { SceneSources } from "./scene-sources";

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
});
