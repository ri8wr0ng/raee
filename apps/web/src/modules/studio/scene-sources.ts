import type { SourceLayout } from "./source-layout";

/** One open or saved source as one scene shows it. */
export type Placement = {
  /** Stable identity surviving reloads (e.g. "camera:<deviceId>" or "screen:<n>"). */
  identity?: string | undefined;
  /** UI label, e.g. "Camera 1" or "Screen 1". */
  label?: string | undefined;
  /** Kind of video source. */
  kind?: "camera" | "screen" | undefined;
  /** Placement geometry on canvas. */
  layout: SourceLayout;
  /** Optional camera deviceId. */
  deviceId?: string | undefined;
  /** Deprecated alias for identity. */
  sourceId?: string | undefined;
};

export type SavedPlacement = {
  identity: string;
  label: string;
  kind: "camera" | "screen";
  layout: SourceLayout;
  deviceId?: string | undefined;
};

export type SavedArrangements = {
  sourceNumbers: { camera: number; screen: number };
  scenes: Record<string, SavedPlacement[]>;
};

const idOf = (p: Placement) => p.identity ?? p.sourceId ?? "";

/**
 * Which open or saved sources each scene shows, where, and in what order (bottom layer first).
 * Sources themselves are live streams shared by scenes; a scene only places them.
 * The key "" holds the arrangement made before any scene exists.
 */
export class SceneSources {
  #scenes = new Map<string, Placement[]>();

  constructor(scenes?: Record<string, SavedPlacement[]> | Map<string, Placement[]>) {
    if (scenes) {
      if (scenes instanceof Map) {
        for (const [k, v] of scenes) this.#scenes.set(k, [...v]);
      } else {
        this.restore(scenes);
      }
    }
  }

  of(scene: string): readonly Placement[] {
    return this.#scenes.get(scene) ?? [];
  }

  has(scene: string, id: string): boolean {
    return this.of(scene).some((item) => idOf(item) === id);
  }

  /** Whether any scene still shows or saves the source. */
  used(id: string): boolean {
    for (const list of this.#scenes.values()) {
      if (list.some((item) => idOf(item) === id)) return true;
    }
    return false;
  }

  /** Which scenes place this source identity. */
  scenesWith(id: string): string[] {
    const result: string[] = [];
    for (const [scene, list] of this.#scenes) {
      if (list.some((item) => idOf(item) === id)) {
        result.push(scene);
      }
    }
    return result;
  }

  add(scene: string, placement: Placement, at = this.of(scene).length) {
    const id = idOf(placement);
    const list = this.of(scene).filter((item) => idOf(item) !== id);
    const index = Math.max(0, Math.min(at, list.length));
    this.#scenes.set(scene, [...list.slice(0, index), { ...placement }, ...list.slice(index)]);
  }

  /** Takes the source off one scene. Returns true when no scene shows it any more. */
  remove(scene: string, id: string): boolean {
    this.#scenes.set(
      scene,
      this.of(scene).filter((item) => idOf(item) !== id),
    );
    return !this.used(id);
  }

  /** Takes the source off every scene, for a stream that ended. */
  forget(id: string) {
    for (const [scene, list] of this.#scenes) {
      this.#scenes.set(
        scene,
        list.filter((item) => idOf(item) !== id),
      );
    }
  }

  place(scene: string, id: string, layout: SourceLayout) {
    this.#scenes.set(
      scene,
      this.of(scene).map((item) => (idOf(item) === id ? { ...item, layout } : item)),
    );
  }

  /** Moves a source one layer up (towards the viewer) or down within one scene. */
  restack(scene: string, id: string, step: 1 | -1) {
    const list = [...this.of(scene)];
    const from = list.findIndex((item) => idOf(item) === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to]!, list[from]!];
    this.#scenes.set(scene, list);
  }

  /** Starts a scene from another scene's arrangement. */
  copy(from: string, to: string) {
    this.#scenes.set(
      to,
      this.of(from).map((item) => ({ ...item, layout: { ...item.layout } })),
    );
  }

  /** Forgets a scene. Returns the source identities that no scene shows any more. */
  drop(scene: string): string[] {
    const list = this.of(scene);
    this.#scenes.delete(scene);
    return list.map((item) => idOf(item)).filter((id) => Boolean(id) && !this.used(id));
  }

  /** Clears all arrangements. */
  clear() {
    this.#scenes.clear();
  }

  /** Updates an identity across all scenes (e.g. camera device switch). */
  updateIdentity(oldId: string, newId: string, newDeviceId?: string) {
    for (const [scene, list] of this.#scenes) {
      this.#scenes.set(
        scene,
        list.map((item) => {
          if (idOf(item) === oldId) {
            return {
              ...item,
              identity: newId,
              sourceId: item.sourceId ? newId : undefined,
              ...(newDeviceId ? { deviceId: newDeviceId } : {}),
            };
          }
          return item;
        }),
      );
    }
  }

  /** Restores arrangements from saved state. */
  restore(scenes: Record<string, SavedPlacement[]>) {
    this.#scenes.clear();
    for (const [scene, placements] of Object.entries(scenes)) {
      if (Array.isArray(placements)) {
        this.#scenes.set(
          scene,
          placements.map((p) => ({
            identity: p.identity,
            label: p.label,
            kind: p.kind,
            layout: { ...p.layout },
            ...(p.deviceId ? { deviceId: p.deviceId } : {}),
          })),
        );
      }
    }
  }

  /** Serializes current arrangements for persistence. */
  serialize(): Record<string, SavedPlacement[]> {
    const result: Record<string, SavedPlacement[]> = {};
    for (const [scene, list] of this.#scenes) {
      if (list.length > 0) {
        result[scene] = list.map((item) => {
          const identity = idOf(item);
          const kind = item.kind ?? (identity.startsWith("screen") ? "screen" : "camera");
          const label = item.label ?? (kind === "screen" ? "Screen" : "Camera");
          return {
            identity,
            label,
            kind,
            layout: { ...item.layout },
            ...(item.deviceId ? { deviceId: item.deviceId } : {}),
          };
        });
      }
    }
    return result;
  }

  /** Placements in a scene whose identity is not in the live set. */
  missing(scene: string, liveIdentities: Iterable<string>): SavedPlacement[] {
    const liveSet = new Set(liveIdentities);
    const result: SavedPlacement[] = [];
    for (const item of this.of(scene)) {
      const id = idOf(item);
      if (!liveSet.has(id)) {
        const kind = item.kind ?? (id.startsWith("screen") ? "screen" : "camera");
        const label = item.label ?? (kind === "screen" ? "Screen" : "Camera");
        result.push({
          identity: id,
          label,
          kind,
          layout: { ...item.layout },
          ...(item.deviceId ? { deviceId: item.deviceId } : {}),
        });
      }
    }
    return result;
  }
}
