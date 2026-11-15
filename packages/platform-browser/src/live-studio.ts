import type { LiveStudio } from "@sidecut/core/live-studio";
import type { LiveAssets } from "@sidecut/core/live-assets";
import { paintLiveEngagement, type LiveEngagement } from "./live-engagement";
import { paintPicture } from "./picture";
import { paintLiveBackground, paintLiveOverlays } from "./live-assets";

/** Asked per frame about that frame's scene, so a draft covers only its own scene. */
export type LivePreviewAssets = (sceneId: string) => LiveAssets | undefined;

/** Preview this canvas and record its stream; both receive the same completed frame. */
export class LiveStudioOutput {
  private busy = false;
  private closed = false;
  private stream: MediaStream | null = null;
  private audioInputId: string | null = null;
  private readonly staging: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly output: CanvasRenderingContext2D;
  private committed: {
    sceneId: string;
    sceneRevision: number;
    commitRevision: number;
    time: number;
  } | null = null;
  private previewAssetsOverride: LiveAssets | LivePreviewAssets | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly studio: LiveStudio,
    private readonly reader: Parameters<typeof paintPicture>[3],
    private readonly engagement?: LiveEngagement,
    private readonly liveLayers?: (context: CanvasRenderingContext2D, time: number) => void,
    private readonly maxOutputHeight = Number.POSITIVE_INFINITY,
    /** Paints the draft look instead of the saved one, for the scene it is asked about. */
    previewAssets?: LivePreviewAssets,
    /**
     * Renders the saved scene this returns instead of the live one: an OBS-style
     * preview. It is never recorded or streamed, and a frame is dropped when the
     * selection or the studio changes while it is being painted.
     */
    private readonly scene?: () => string | undefined,
  ) {
    if (previewAssets) this.previewAssetsOverride = previewAssets;
    this.staging = document.createElement("canvas");
    const context = this.staging.getContext("2d");
    const output = canvas.getContext("2d");
    if (!context || !output) throw new Error("Studio needs a 2D canvas.");
    this.context = context;
    this.output = output;
  }
  get currentFrame() {
    return this.committed ? { ...this.committed } : null;
  }
  /** The override also reaches recordings: return undefined from it while capturing. */
  setPreviewAssets(assets?: LiveAssets | LivePreviewAssets | null) {
    this.previewAssetsOverride = assets ?? null;
  }
  recordingStream(audio?: MediaStream) {
    if (this.closed) throw new Error("Studio output closed.");
    if (!this.committed) throw new Error("Render a complete frame before recording.");
    const tracks = audio?.getAudioTracks();
    if (tracks && (tracks.length !== 1 || tracks[0]?.readyState !== "live"))
      throw new Error("Studio recording needs exactly one live mixed audio track.");
    if (audio && this.audioInputId && this.audioInputId !== audio.id)
      throw new Error("Recording is already bound to another audio mix.");
    if (!this.stream) {
      this.stream = this.canvas.captureStream(0);
      const track = this.stream.getVideoTracks()[0];
      if (!track || !("requestFrame" in track) || typeof track.requestFrame !== "function") {
        this.close();
        throw new Error("Explicit canvas capture frames are unavailable.");
      }
    }
    if (audio && !this.audioInputId) {
      for (const track of audio.getAudioTracks()) this.stream.addTrack(track.clone());
      this.audioInputId = audio.id;
    }
    return this.stream;
  }
  async render(time: number, signal?: AbortSignal) {
    if (this.closed) throw new Error("Studio output closed.");
    if (this.busy) return null;
    this.busy = true;
    try {
      signal?.throwIfAborted();
      const sceneId = this.scene?.();
      const frame =
        sceneId === undefined ? this.studio.frame(time) : this.studio.frameScene(sceneId, time);
      const preview =
        typeof this.previewAssetsOverride === "function"
          ? this.previewAssetsOverride(frame.sceneId)
          : this.previewAssetsOverride;
      const assets = preview ?? frame.assets;
      const settings = frame.project.settings;
      if (
        settings.width > 3840 ||
        settings.height > 3840 ||
        settings.width * settings.height > 3840 * 2160
      )
        throw new Error("Studio output exceeds the 4K pixel limit.");
      const scale = Math.min(1, this.maxOutputHeight / settings.height);
      const width = Math.round((settings.width * scale) / 2) * 2;
      const height = Math.round((settings.height * scale) / 2) * 2;
      // Resizing reallocates and clears the canvas, so only do it when the output size changes.
      if (this.staging.width !== width) this.staging.width = width;
      if (this.staging.height !== height) this.staging.height = height;
      const reducedMotion =
        typeof window !== "undefined" && typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
          : false;
      await paintPicture(
        this.context,
        frame.project,
        time,
        this.reader,
        signal,
        undefined,
        assets ? (context) => paintLiveBackground(context, assets, time, reducedMotion) : undefined,
      );
      this.liveLayers?.(this.context, time);
      if (assets) paintLiveOverlays(this.context, assets, time, reducedMotion);
      if (this.engagement) paintLiveEngagement(this.context, this.engagement, time, reducedMotion);
      signal?.throwIfAborted();
      if (this.closed) return null;
      if (this.scene) {
        if (this.scene() !== sceneId || this.studio.currentRevision !== frame.commitRevision)
          return null;
      } else if (this.studio.frame(time).commitRevision !== frame.commitRevision) {
        return null;
      }
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this.output.setTransform(1, 0, 0, 1, 0, 0);
      this.output.globalAlpha = 1;
      this.output.drawImage(this.staging, 0, 0);
      this.committed = {
        sceneId: frame.sceneId,
        sceneRevision: frame.sceneRevision,
        commitRevision: frame.commitRevision,
        time,
      };
      const track = this.stream?.getVideoTracks()[0];
      if (track && "requestFrame" in track && typeof track.requestFrame === "function")
        track.requestFrame();
      return this.currentFrame;
    } finally {
      this.busy = false;
    }
  }
  close() {
    this.closed = true;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }
}
