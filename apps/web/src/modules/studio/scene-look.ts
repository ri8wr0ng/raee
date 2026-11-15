import type { LiveAssets } from "@sidecut/core/live-assets";

export type LookDraft = { sceneId: string | null; assets: LiveAssets };

export function lookForScene(
  frameSceneId: string | null | undefined,
  draft: LookDraft | null | undefined,
): LiveAssets | undefined {
  if (!frameSceneId || !draft) return undefined;
  return draft.sceneId === frameSceneId ? draft.assets : undefined;
}

/** Captures must not include unsaved looks. */
export function programLook(
  frameSceneId: string | null | undefined,
  draft: LookDraft | null | undefined,
  capturing: { recording: boolean; buffering: boolean },
): LiveAssets | undefined {
  if (capturing.recording || capturing.buffering) return undefined;
  return lookForScene(frameSceneId, draft);
}
