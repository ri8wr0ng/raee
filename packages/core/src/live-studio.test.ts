import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { LiveStudio, LiveStudioRenditions } from "./live-studio";
import { layerGeometry, sourceCrop } from "./render-plan";

const overlay = (text: string) => ({
  id: "ov",
  kind: "banner",
  text,
  x: 0.05,
  y: 0.8,
  width: 0.9,
  height: 0.12,
  color: "#38bdf8",
  textColor: "#ffffff",
  opacity: 1,
  enabled: true,
  motion: "none",
  start: 0,
  duration: 86400,
});

const projectWithLook = (...overlays: ReturnType<typeof overlay>[]) =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "p",
      settings: { width: 1920, height: 1080 },
      liveAssets: {
        background: "solid",
        color: "#111827",
        accent: "#38bdf8",
        speed: 1,
        motion: true,
        overlays,
      },
      videoTracks: [],
    },
  }).project;

const project = (width = 1920) =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "p",
      settings: { width, height: 1080 },
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [
            {
              id: "c",
              duration: 100,
              content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } },
              video: {
                transform: { scale: 0.5, rotation: 30, position: { x: 0.25, y: 0.75 } },
                crop: { left: 0.1, top: 0.2, right: 0.1, bottom: 0.2 },
              },
            },
          ],
        },
      ],
    },
  }).project;

describe("saved live scenes", () => {
  it("reuses editor transforms and crop masks and freezes each committed revision", () => {
    const studio = new LiveStudio();
    studio.save({ id: "a", name: "A", project: project(), expectedRevision: 0 });
    studio.switch({ id: "a", expectedRevision: 1 });
    const frame = studio.frame(1);
    const clip = frame.plan.layers[0]?.clip;
    if (!clip) throw new Error("Missing layer");
    expect(layerGeometry(clip, 1920, 1080, 1920, 1080)).toMatchObject({
      x: 480,
      y: 810,
      width: 960,
      height: 540,
    });
    expect(sourceCrop(clip, 100, 100)).toEqual({ x: 10, y: 20, width: 80, height: 60 });
    expect(Object.isFrozen(frame.project)).toBe(true);
    studio.save({ id: "a", name: "Edited", project: project(), expectedRevision: 2 });
    expect(studio.frame(1).sceneRevision).toBe(1);
    studio.switch({ id: "a", expectedRevision: 3 });
    expect(studio.frame(1).sceneRevision).toBe(2);
    expect(frame.sceneRevision).toBe(1);
  });

  it("paints the on-air scene's latest saved look without a cut", () => {
    const studio = new LiveStudio();
    studio.save({
      id: "a",
      name: "A",
      project: projectWithLook(overlay("Invalid!")),
      expectedRevision: 0,
    });
    studio.switch({ id: "a", expectedRevision: 1 });
    expect(studio.frame(0).assets?.overlays.map((item) => item.text)).toEqual(["Invalid!"]);

    studio.save({
      id: "a",
      name: "A",
      project: projectWithLook(),
      expectedRevision: 2,
    });
    const frame = studio.frame(0);
    expect(frame.assets?.overlays).toEqual([]);
    expect(frame.sceneRevision).toBe(1);
    expect(studio.activeScene?.revision).toBe(1);

    studio.switch({ id: "a", expectedRevision: 3 });
    expect(studio.frame(0).assets?.overlays).toEqual([]);
    expect(studio.frame(0).sceneRevision).toBe(2);
  });

  it("rejects stale edits, missing scenes, invalid times and incompatible output changes", () => {
    const studio = new LiveStudio();
    expect(() => studio.frame(0)).toThrow("Select");
    studio.save({ id: "a", name: "A", project: project(), expectedRevision: 0 });
    expect(() => studio.switch({ id: "a", expectedRevision: 0 })).toThrow("changed");
    studio.switch({ id: "a", expectedRevision: 1 });
    studio.save({ id: "b", name: "B", project: project(1280), expectedRevision: 2 });
    expect(() => studio.switch({ id: "b", expectedRevision: 3 })).toThrow("same output");
    expect(() => studio.remove({ id: "a", expectedRevision: 3 })).toThrow("Switch away");
    expect(() => studio.frame(NaN)).toThrow("Invalid");
    expect(studio.frame(0).sceneId).toBe("a");
  });

  it("renders any saved scene for preview without touching the program", () => {
    const studio = new LiveStudio();
    studio.save({ id: "a", name: "A", project: project(), expectedRevision: 0 });
    studio.switch({ id: "a", expectedRevision: 1 });
    studio.save({ id: "b", name: "B", project: project(), expectedRevision: 2 });

    const preview = studio.frameScene("b", 1);
    expect(preview.sceneId).toBe("b");
    expect(preview.sceneRevision).toBe(1);
    expect(preview.commitRevision).toBe(studio.currentRevision);
    expect(Object.isFrozen(preview.project)).toBe(true);
    // The decoded snapshot is cached per saved revision.
    expect(studio.frameScene("b", 2).project).toBe(preview.project);

    // Nothing about the program moved.
    expect(studio.activeScene?.id).toBe("a");
    expect(studio.frame(1).sceneId).toBe("a");
    expect(studio.currentRevision).toBe(3);

    studio.save({ id: "b", name: "B edited", project: project(), expectedRevision: 3 });
    expect(studio.frameScene("b", 1).sceneRevision).toBe(2);
    expect(studio.frameScene("b", 1).project).not.toBe(preview.project);
    expect(studio.frame(1).sceneId).toBe("a");

    expect(() => studio.frameScene("missing", 0)).toThrow("unavailable");
    expect(() => studio.frameScene("b", -1)).toThrow("Invalid");
  });

  it("persists saved drafts separately from the active snapshot", () => {
    const studio = new LiveStudio();
    studio.save({ id: "a", name: "A", project: project(), expectedRevision: 0 });
    studio.switch({ id: "a", expectedRevision: 1 });
    studio.save({ id: "a", name: "Draft", project: project(), expectedRevision: 2 });
    const restored = LiveStudio.restore(studio.serialize());
    expect(restored.frame(0).sceneRevision).toBe(1);
    expect(restored.frame(0).commitRevision).toBe(2);
    expect(restored.list()[0]?.revision).toBe(2);
    expect(() => LiveStudio.restore('{"schemaVersion":2}')).toThrow();
    restored.switch({ id: "a", expectedRevision: 3 });
    expect(restored.frame(0).sceneRevision).toBe(2);
  });
});

describe("independent live renditions", () => {
  it("keeps composition revisions independent and rejects wrong orientation", () => {
    const outputs = new LiveStudioRenditions();
    const horizontal = project();
    const tall = project(1080);
    const vertical = { ...tall, settings: { ...tall.settings, height: 1920 } };
    outputs.save({
      output: "horizontal",
      id: "h",
      name: "Wide",
      project: horizontal,
      expectedRevision: 0,
    });
    outputs.save({
      output: "vertical",
      id: "v",
      name: "Tall",
      project: vertical,
      expectedRevision: 0,
    });
    outputs.horizontal.switch({ id: "h", expectedRevision: 1 });
    outputs.vertical.switch({ id: "v", expectedRevision: 1 });
    expect(outputs.horizontal.frame(0).project.settings.width).toBe(1920);
    expect(outputs.vertical.frame(0).project.settings.height).toBe(1920);
    outputs.save({
      output: "horizontal",
      id: "h",
      name: "Changed",
      project: horizontal,
      expectedRevision: 2,
    });
    expect(outputs.vertical.currentRevision).toBe(2);
    expect(() =>
      outputs.save({
        output: "vertical",
        id: "bad",
        name: "Bad",
        project: horizontal,
        expectedRevision: 2,
      }),
    ).toThrow(/dimensions/);
  });
});
