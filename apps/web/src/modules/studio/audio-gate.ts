import type { SceneSources } from "./scene-sources";

export type AudioGateInput = {
  readonly id?: string | undefined;
  readonly sourceId?: string | undefined;
  /** A scene microphone is placed by its own identity. */
  readonly identity?: string | undefined;
};

/**
 * Resolves which scene key governs the live program mix.
 * If scenes exist, the active scene's ID is used.
 * If no scenes have been created yet, the pre-scene arrangement key ("") is used.
 * If scenes exist but none is currently active, returns null (no scene is on air).
 */
export function activeLiveSceneKey(
  activeScene: { readonly id: string } | null | undefined,
  hasScenes: boolean,
): string | null {
  if (activeScene) return activeScene.id;
  return hasScenes ? null : "";
}

/**
 * Audio belonging to a video source is open to the program mix only while the
 * active scene shows that source. Standalone inputs (microphones, soundboard)
 * are always open.
 */
export function isAudioInputOpen(
  input: AudioGateInput,
  liveSceneKey: string | null | undefined,
  arrangement: Pick<SceneSources, "has">,
): boolean {
  if (!input.sourceId) return true;
  if (liveSceneKey === null || liveSceneKey === undefined) return false;
  return arrangement.has(liveSceneKey, input.sourceId);
}

/**
 * Audio inputs point at their video source by its per-session id, while scenes place
 * sources by their saved identity. Resolves the identity the gate should look up.
 */
export function gateSourceKey(
  input: AudioGateInput,
  sources: readonly { readonly id: string; readonly identity: string }[],
): string | undefined {
  if (input.identity) return input.identity;
  if (!input.sourceId) return undefined;
  return sources.find((source) => source.id === input.sourceId)?.identity ?? input.sourceId;
}
