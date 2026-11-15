import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { LiveStudioOutput } from "./live-studio";
import { LiveStudio } from "@sidecut/core/live-studio";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { DEFAULT_LIVE_ASSETS, type LiveAssets } from "@sidecut/core/live-assets";

const mockContext = () => {
  const calls: string[] = [];
  const ctx = {
    canvas: { width: 320, height: 180 },
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fillRect: vi.fn((...args) => calls.push(`fillRect:${args.join(",")}`)),
    strokeRect: vi.fn((...args) => calls.push(`strokeRect:${args.join(",")}`)),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn((text) => calls.push(`fillText:${text}`)),
    translate: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    calls,
  };
  return ctx;
};

const makeMockCanvas = () => {
  const ctx = mockContext();
  return {
    width: 320,
    height: 180,
    getContext: vi.fn((type: string) => (type === "2d" ? ctx : null)),
    ctx,
  };
};

const createProject = (assets?: LiveAssets) =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "p",
      settings: { width: 320, height: 180 },
      ...(assets ? { liveAssets: assets } : {}),
      videoTracks: [],
    },
  }).project;

describe("LiveStudioOutput previewAssets override", () => {
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    originalCreateElement = globalThis.document?.createElement;
    const mockStagingCanvas = makeMockCanvas();
    if (!globalThis.document) {
      (globalThis as unknown as { document: Partial<Document> }).document = {
        createElement: vi.fn((tag: string) => {
          if (tag === "canvas") return mockStagingCanvas as unknown as HTMLCanvasElement;
          return {} as HTMLElement;
        }) as unknown as typeof document.createElement,
      };
    } else {
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        if (tag === "canvas") return mockStagingCanvas as unknown as HTMLCanvasElement;
        return originalCreateElement.call(document, tag);
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("paints from previewAssets override when set, and falls back to frame.assets when undefined", async () => {
    const savedAssets: LiveAssets = {
      ...DEFAULT_LIVE_ASSETS,
      color: "#111111",
      background: "solid",
      overlays: [
        {
          id: "saved-ov",
          kind: "banner",
          text: "Saved Overlay",
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.1,
          color: "#000000",
          textColor: "#ffffff",
          opacity: 1,
          enabled: true,
          motion: "none",
          start: 0,
          duration: 10,
        },
      ],
    };

    const draftAssets: LiveAssets = {
      ...DEFAULT_LIVE_ASSETS,
      color: "#222222",
      background: "solid",
      overlays: [
        {
          id: "draft-ov",
          kind: "banner",
          text: "Draft Overlay",
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.1,
          color: "#333333",
          textColor: "#ffffff",
          opacity: 1,
          enabled: true,
          motion: "none",
          start: 0,
          duration: 10,
        },
        {
          id: "disabled-ov",
          kind: "banner",
          text: "Disabled Overlay",
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.1,
          color: "#444444",
          textColor: "#ffffff",
          opacity: 1,
          enabled: false,
          motion: "none",
          start: 0,
          duration: 10,
        },
      ],
    };

    const studio = new LiveStudio();
    studio.save({
      id: "s1",
      name: "Scene 1",
      project: createProject(savedAssets),
      expectedRevision: 0,
    });
    studio.switch({ id: "s1", expectedRevision: 1 });

    const canvas = makeMockCanvas() as unknown as HTMLCanvasElement;
    let override: LiveAssets | undefined = draftAssets;

    const output = new LiveStudioOutput(
      canvas,
      studio,
      async () => {
        throw new Error("No media");
      },
      undefined,
      undefined,
      1080,
      () => override,
    );

    // 1. Outside capture: previewAssets getter returns draftAssets
    await output.render(1);
    const stagingCtx = (output as unknown as { staging: { ctx: ReturnType<typeof mockContext> } })
      .staging.ctx;
    expect(stagingCtx.calls).toContain("fillText:Draft Overlay");
    expect(stagingCtx.calls).not.toContain("fillText:Saved Overlay");
    expect(stagingCtx.calls).not.toContain("fillText:Disabled Overlay");

    // 2. During capture: getter returns undefined -> falls back to saved frame.assets
    stagingCtx.calls.length = 0;
    override = undefined;
    await output.render(1);
    expect(stagingCtx.calls).toContain("fillText:Saved Overlay");
    expect(stagingCtx.calls).not.toContain("fillText:Draft Overlay");

    // 3. Using setPreviewAssets method
    stagingCtx.calls.length = 0;
    output.setPreviewAssets(draftAssets);
    await output.render(1);
    expect(stagingCtx.calls).toContain("fillText:Draft Overlay");

    // 4. Clearing setPreviewAssets resets back to frame.assets
    stagingCtx.calls.length = 0;
    output.setPreviewAssets(null);
    override = undefined;
    await output.render(1);
    expect(stagingCtx.calls).toContain("fillText:Saved Overlay");

    // 5. Removed overlays are not painted
    stagingCtx.calls.length = 0;
    output.setPreviewAssets({ ...draftAssets, overlays: [] });
    await output.render(1);
    expect(stagingCtx.calls).not.toContain("fillText:Draft Overlay");
    expect(stagingCtx.calls).not.toContain("fillText:Saved Overlay");

    // 6. Background override changes fillStyle and paints
    stagingCtx.calls.length = 0;
    output.setPreviewAssets({
      ...draftAssets,
      overlays: [],
      background: "mesh",
      color: "#abcdef",
      accent: "#fedcba",
    });
    await output.render(1);
    expect(stagingCtx.calls).toContain("fillRect:0,0,320,180");
    expect(stagingCtx.fillStyle).toBe("#fedcba");

    output.close();

    // 7. Constructor accepting a preview callback
    const outputWithOptions = new LiveStudioOutput(
      canvas,
      studio,
      async () => {
        throw new Error("No media");
      },
      undefined,
      undefined,
      1080,
      () => draftAssets,
    );
    stagingCtx.calls.length = 0;
    await outputWithOptions.render(1);
    expect(stagingCtx.calls).toContain("fillText:Draft Overlay");
    outputWithOptions.close();
  });

  it("paints a chosen scene for preview and drops the frame when the choice moves", async () => {
    const overlay = (text: string): LiveAssets => ({
      ...DEFAULT_LIVE_ASSETS,
      overlays: [
        {
          id: text,
          kind: "banner",
          text,
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.1,
          color: "#000000",
          textColor: "#ffffff",
          opacity: 1,
          enabled: true,
          motion: "none",
          start: 0,
          duration: 10,
        },
      ],
    });
    const studio = new LiveStudio();
    studio.save({
      id: "s1",
      name: "One",
      project: createProject(overlay("Live Scene")),
      expectedRevision: 0,
    });
    studio.save({
      id: "s2",
      name: "Two",
      project: createProject(overlay("Preview Scene")),
      expectedRevision: 1,
    });
    studio.switch({ id: "s1", expectedRevision: 2 });

    const canvas = makeMockCanvas() as unknown as HTMLCanvasElement;
    let scene: string | undefined = "s2";
    const output = new LiveStudioOutput(
      canvas,
      studio,
      async () => {
        throw new Error("No media");
      },
      undefined,
      undefined,
      1080,
      undefined,
      () => scene,
    );
    const stagingCtx = (output as unknown as { staging: { ctx: ReturnType<typeof mockContext> } })
      .staging.ctx;

    // The preview paints the saved scene that is not on air.
    await output.render(1);
    expect(stagingCtx.calls).toContain("fillText:Preview Scene");
    expect(stagingCtx.calls).not.toContain("fillText:Live Scene");

    // A selection change mid-render drops the stale frame instead of committing it.
    stagingCtx.calls.length = 0;
    const pending = output.render(1);
    scene = "s1";
    expect(await pending).toBeNull();
    scene = "s2";

    // A studio change mid-render drops the frame too.
    const pendingSave = output.render(1);
    studio.save({ id: "s2", name: "Two edited", project: createProject(), expectedRevision: 3 });
    expect(await pendingSave).toBeNull();
    stagingCtx.calls.length = 0;
    await output.render(1);
    expect(stagingCtx.calls).not.toContain("fillText:Preview Scene");

    output.close();
  });

  it("keeps commitRevision stale-frame check intact", async () => {
    const studio = new LiveStudio();
    studio.save({ id: "s1", name: "Scene 1", project: createProject(), expectedRevision: 0 });
    studio.save({ id: "s2", name: "Scene 2", project: createProject(), expectedRevision: 1 });
    studio.switch({ id: "s1", expectedRevision: 2 });

    const canvas = makeMockCanvas() as unknown as HTMLCanvasElement;
    const output = new LiveStudioOutput(canvas, studio, async () => {
      throw new Error("No media");
    });

    const renderPromise = output.render(0);
    // Switch scene while render is in flight to simulate stale frame
    studio.switch({ id: "s2", expectedRevision: 3 });
    const result = await renderPromise;
    expect(result).toBeNull();

    output.close();
  });
});
