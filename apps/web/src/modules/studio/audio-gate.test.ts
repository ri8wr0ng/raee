import { describe, expect, it } from "vite-plus/test";
import { SceneSources } from "./scene-sources";
import { activeLiveSceneKey, gateSourceKey, isAudioInputOpen } from "./audio-gate";

const layout = { x: 0, y: 0, w: 1 };
const place = (identity: string) =>
  ({ identity, label: identity, kind: "screen", layout }) as const;

describe("audio gate decision logic", () => {
  it("always keeps standalone inputs open (microphones, soundboard)", () => {
    const scenes = new SceneSources();
    scenes.add("scene-1", place("screen-1"));

    const mic = { id: "mic-1" };
    expect(isAudioInputOpen(mic, "scene-1", scenes)).toBe(true);
    expect(isAudioInputOpen(mic, "scene-2", scenes)).toBe(true);
    expect(isAudioInputOpen(mic, null, scenes)).toBe(true);
    expect(isAudioInputOpen(mic, "", scenes)).toBe(true);
  });

  it("opens source audio only when the active scene shows that source", () => {
    const scenes = new SceneSources();
    scenes.add("scene-1", place("screen-1"));
    scenes.add("scene-2", place("camera-1"));

    const screenAudio = { id: "screen-1:audio", sourceId: "screen-1" };
    const cameraAudio = { id: "camera-1:audio", sourceId: "camera-1" };

    // On Scene 1: screen audio is heard, camera audio is gated
    expect(isAudioInputOpen(screenAudio, "scene-1", scenes)).toBe(true);
    expect(isAudioInputOpen(cameraAudio, "scene-1", scenes)).toBe(false);

    // Switch to Scene 2: camera audio is heard, screen audio is gated
    expect(isAudioInputOpen(screenAudio, "scene-2", scenes)).toBe(false);
    expect(isAudioInputOpen(cameraAudio, "scene-2", scenes)).toBe(true);
  });

  it("handles adding existing sources to multiple scenes", () => {
    const scenes = new SceneSources();
    scenes.add("scene-1", place("cam-shared"));
    scenes.add("scene-2", place("cam-shared"));

    const sharedAudio = { id: "cam-shared:audio", sourceId: "cam-shared" };
    expect(isAudioInputOpen(sharedAudio, "scene-1", scenes)).toBe(true);
    expect(isAudioInputOpen(sharedAudio, "scene-2", scenes)).toBe(true);
    expect(isAudioInputOpen(sharedAudio, "scene-3", scenes)).toBe(false);
  });

  it("gates video-source audio when no active scene is live", () => {
    const scenes = new SceneSources();
    scenes.add("scene-1", place("screen-1"));

    const screenAudio = { id: "screen-1:audio", sourceId: "screen-1" };
    expect(isAudioInputOpen(screenAudio, null, scenes)).toBe(false);
    expect(isAudioInputOpen(screenAudio, undefined, scenes)).toBe(false);
  });

  it("supports pre-scene arrangement before any scenes are created", () => {
    const scenes = new SceneSources();
    scenes.add("", place("screen-1"));

    const screenAudio = { id: "screen-1:audio", sourceId: "screen-1" };
    const liveKey = activeLiveSceneKey(null, false);
    expect(liveKey).toBe("");
    expect(isAudioInputOpen(screenAudio, liveKey, scenes)).toBe(true);
  });

  it("resolves activeLiveSceneKey correctly", () => {
    expect(activeLiveSceneKey({ id: "scene-a" }, true)).toBe("scene-a");
    expect(activeLiveSceneKey({ id: "scene-a" }, false)).toBe("scene-a");
    expect(activeLiveSceneKey(null, false)).toBe("");
    expect(activeLiveSceneKey(null, true)).toBe(null);
  });
});

describe("gateSourceKey", () => {
  it("opens a source's audio by its saved identity, not its session id", () => {
    const scenes = new SceneSources();
    scenes.add("live", {
      identity: "screen:1",
      label: "Screen 1",
      kind: "screen",
      layout: { x: 0, y: 0, w: 1 },
    });
    const sources = [{ id: "uuid-1", identity: "screen:1" }];
    const input = { id: "uuid-1:audio", sourceId: "uuid-1" };
    expect(isAudioInputOpen({ sourceId: gateSourceKey(input, sources) }, "live", scenes)).toBe(
      true,
    );
    expect(isAudioInputOpen({ sourceId: gateSourceKey(input, sources) }, "other", scenes)).toBe(
      false,
    );
    expect(gateSourceKey({ id: "mic" }, sources)).toBeUndefined();
  });
});

describe("scene microphones", () => {
  it("are heard only on scenes that hold them", () => {
    const scenes = new SceneSources();
    scenes.add("talk", place("audio:mic-1"));
    const mic = { id: "m", identity: "audio:mic-1" };
    expect(isAudioInputOpen({ sourceId: gateSourceKey(mic, []) }, "talk", scenes)).toBe(true);
    expect(isAudioInputOpen({ sourceId: gateSourceKey(mic, []) }, "brb", scenes)).toBe(false);
  });
});
