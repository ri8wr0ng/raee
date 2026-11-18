import type { SourceLayout } from "./source-layout";

/** Sources a scene can hold, like OBS: pictures (camera, screen, video) and audio-only inputs. */
export type SourceKind = "camera" | "screen" | "video" | "audio";

/** One source as one scene shows it; also the saved form. */
export type Placement = {
  /**
   * Survives reloads: "camera:<deviceId>" (with "#n" when a device is open twice), "screen:<n>",
   * "video:<mediaId>" or "audio:<deviceId>".
   */
  identity: string;
  /** What the Sources panel calls it, e.g. "Camera 1". */
  label: string;
  kind: SourceKind;
  /** Where the picture sits. Audio sources have no picture and keep the full frame here. */
  layout: SourceLayout;
  /** The camera or microphone to reopen on Reconnect. */
  deviceId?: string | undefined;
  /** The project media a video source plays. */
  mediaId?: string | undefined;
  /** The desktop app's id for the screen or window a screen source captured. */
  display?: string | undefined;
};

/** Whether a source kind draws a picture on the program. */
export const hasPicture = (kind: SourceKind) => kind !== "audio";

export type SavedArrangements = {
  sourceNumbers: { camera: number; screen: number };
  scenes: Record<string, Placement[]>;
};

/** The scene key for sources arranged before any scene exists. */
export const PRE_SCENE = "";

const clone = (item: Placement): Placement => ({ ...item, layout: { ...item.layout } });

/** The identity without its "#n" copy number, e.g. "camera:abc#2" → "camera:abc". */
export const baseIdentity = (identity: string) => identity.replace(/#\d+$/, "");

/** The camera or microphone a saved identity names, for placements saved without one. */
const deviceOf = (identity: string) => {
  const match = /^(?:camera|audio):(.*)$/.exec(baseIdentity(identity));
  return match && match[1] !== "default" ? match[1] : undefined;
};

/**
 * Which sources each scene shows, where, and in what order (bottom layer first).
 * Sources are keyed by identity, so a scene keeps its placements while a source is not
 * connected and gets them back when the same camera or screen is reopened.
 * Every identity belongs to one scene only: scenes never share a source.
 */
export class SceneSources {
  #scenes = new Map<string, Placement[]>();

  of(scene: string): readonly Placement[] {
    return this.#scenes.get(scene) ?? [];
  }

  has(scene: string, identity: string) {
    return this.of(scene).some((item) => item.identity === identity);
  }

  /** Whether any scene places the source. */
  used(identity: string) {
    return this.scenesWith(identity).length > 0;
  }

  /** The scenes that place this source. */
  scenesWith(identity: string) {
    return [...this.#scenes]
      .filter(([, list]) => list.some((item) => item.identity === identity))
      .map(([scene]) => scene);
  }

  /**
   * An identity no scene uses yet: `base` itself, else `base#n`. `taken` adds identities
   * in use elsewhere, such as open sources not placed on any scene.
   */
  unique(base: string, taken: Iterable<string> = []) {
    const used = new Set(taken);
    for (const list of this.#scenes.values()) for (const item of list) used.add(item.identity);
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}#${n}`)) n += 1;
    return `${base}#${n}`;
  }

  add(scene: string, placement: Placement, at = this.of(scene).length) {
    const list = this.of(scene).filter((item) => item.identity !== placement.identity);
    const index = Math.max(0, Math.min(at, list.length));
    this.#scenes.set(scene, [...list.slice(0, index), clone(placement), ...list.slice(index)]);
  }

  /** Takes the source off one scene. Returns true when no scene places it any more. */
  remove(scene: string, identity: string) {
    this.#scenes.set(
      scene,
      this.of(scene).filter((item) => item.identity !== identity),
    );
    return !this.used(identity);
  }

  /** Takes the source off every scene. */
  forget(identity: string) {
    for (const scene of this.#scenes.keys()) this.remove(scene, identity);
  }

  place(scene: string, identity: string, layout: SourceLayout) {
    this.#scenes.set(
      scene,
      this.of(scene).map((item) => (item.identity === identity ? { ...item, layout } : item)),
    );
  }

  /** Moves a source one layer up (towards the viewer) or down within one scene. */
  restack(scene: string, identity: string, step: 1 | -1) {
    const list = [...this.of(scene)];
    const from = list.findIndex((item) => item.identity === identity);
    const to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to]!, list[from]!];
    this.#scenes.set(scene, list);
  }

  /** Starts a scene from another scene's arrangement. */
  copy(from: string, to: string) {
    this.#scenes.set(to, this.of(from).map(clone));
  }

  /** Forgets a scene. Returns the sources that no scene places any more. */
  drop(scene: string) {
    const list = this.of(scene);
    this.#scenes.delete(scene);
    return list.map((item) => item.identity).filter((identity) => !this.used(identity));
  }

  clear() {
    this.#scenes.clear();
  }

  /** Re-keys a source in every scene, e.g. after its camera device is switched. */
  updateIdentity(from: string, to: string, deviceId?: string) {
    for (const [scene, list] of this.#scenes)
      this.#scenes.set(
        scene,
        list.map((item) =>
          item.identity === from
            ? { ...item, identity: to, ...(deviceId ? { deviceId } : {}) }
            : item,
        ),
      );
  }

  /** Updates what a source opens on Reconnect in every scene that places it. */
  annotate(identity: string, patch: { deviceId?: string; display?: string }) {
    for (const [scene, list] of this.#scenes)
      this.#scenes.set(
        scene,
        list.map((item) => (item.identity === identity ? { ...item, ...patch } : item)),
      );
  }

  /**
   * Restores saved arrangements. Older saves let scenes share a source; each later scene
   * that shares one gets its own copy under a new identity, so no source spans two scenes.
   */
  restore(scenes: Record<string, readonly Placement[]>) {
    this.#scenes.clear();
    for (const [scene, list] of Object.entries(scenes)) {
      const own = list.map((item) => {
        if (!this.used(item.identity)) return clone(item);
        const deviceId = item.deviceId ?? deviceOf(item.identity);
        return {
          ...clone(item),
          identity: this.unique(
            baseIdentity(item.identity),
            list.map((other) => other.identity),
          ),
          ...(deviceId ? { deviceId } : {}),
        };
      });
      this.#scenes.set(scene, own);
    }
  }

  serialize(): Record<string, Placement[]> {
    const result: Record<string, Placement[]> = {};
    for (const [scene, list] of this.#scenes) if (list.length) result[scene] = list.map(clone);
    return result;
  }
}
