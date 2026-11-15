import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_LIVE_ASSETS, type LiveAssets, type LiveOverlay } from "@sidecut/core/live-assets";
import { lookForScene, programLook } from "./scene-look";

const overlay = (id: string, text: string, enabled = true): LiveOverlay => ({
  id,
  kind: "banner",
  text,
  x: 0.05,
  y: 0.8,
  width: 0.9,
  height: 0.12,
  color: "#38bdf8",
  textColor: "#ffffff",
  opacity: 1,
  enabled,
  motion: "none",
  start: 0,
  duration: 86400,
});

const look = (...overlays: LiveOverlay[]): LiveAssets => ({
  ...DEFAULT_LIVE_ASSETS,
  overlays,
});

const texts = (assets: LiveAssets | undefined) => assets?.overlays.map((item) => item.text) ?? [];

describe("scene look painting", () => {
  it("paints a draft only over the scene it belongs to", () => {
    const draft = { sceneId: "one", assets: look(overlay("ov", "Invalid!")) };

    expect(texts(lookForScene("one", draft))).toEqual(["Invalid!"]);
    expect(lookForScene("two", draft)).toBeUndefined();
    expect(lookForScene(null, draft)).toBeUndefined();
    expect(lookForScene("one", null)).toBeUndefined();
  });

  it("clears a removed or disabled overlay as soon as the draft drops it", () => {
    const banner = overlay("ov", "Invalid!");

    expect(texts(lookForScene("one", { sceneId: "one", assets: look(banner) }))).toEqual([
      "Invalid!",
    ]);
    const hidden = lookForScene("one", {
      sceneId: "one",
      assets: look({ ...banner, enabled: false }),
    });
    expect(hidden?.overlays[0]?.enabled).toBe(false);
    const removed = lookForScene("one", { sceneId: "one", assets: look() });
    expect(removed?.overlays).toEqual([]);
  });

  it("drops the draft on a scene cut so the on-air scene's own look paints", () => {
    const draft = { sceneId: "one", assets: look(overlay("ov", "Invalid!")) };

    expect(programLook("two", draft, { recording: false, buffering: false })).toBeUndefined();
  });

  it("keeps recordings and armed clip buffers on saved looks", () => {
    const draft = { sceneId: "one", assets: look(overlay("ov", "Invalid!")) };

    expect(programLook("one", draft, { recording: true, buffering: false })).toBeUndefined();
    expect(programLook("one", draft, { recording: false, buffering: true })).toBeUndefined();
    expect(texts(programLook("one", draft, { recording: false, buffering: false }))).toEqual([
      "Invalid!",
    ]);
  });
});
