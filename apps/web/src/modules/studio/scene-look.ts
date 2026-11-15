import type { LiveAssets } from "@sidecut/core/live-assets";

/**
 * The look editor's draft for one scene: the look it saved plus edits that are not saved yet.
 * The scene ID travels with the assets, so a draft can never be painted over another scene.
 */
export type LookDraft = { sceneId: string | null; assets: LiveAssets };

/**
 * The look a canvas paints over a frame of `frameSceneId`.
 *
 * The program renders the scene on air and the preview renders the scene being edited, so a
 * draft is painted only when it belongs to that exact scene. Returning undefined leaves the
 * scene's own saved look in charge, which is how a cut to another scene drops a stale draft.
 */
export function lookForScene(
  frameSceneId: string | null | undefined,
  draft: LookDraft | null | undefined,
): LiveAssets | undefined {
  if (!frameSceneId || !draft) return undefined;
  return draft.sceneId === frameSceneId ? draft.assets : undefined;
}

/**
 * The program canvas paints the draft of the scene on air. A recording or an armed clip
 * buffer captures this canvas, and neither may contain a look that is not saved yet.
 */
export function programLook(
  frameSceneId: string | null | undefined,
  draft: LookDraft | null | undefined,
  capturing: { recording: boolean; buffering: boolean },
): LiveAssets | undefined {
  if (capturing.recording || capturing.buffering) return undefined;
  return lookForScene(frameSceneId, draft);
}
