import type { SourceLayout } from "./source-layout";

/** One open source as one scene shows it. */
export type Placement = { sourceId: string; layout: SourceLayout };

/**
 * Which open sources each scene shows, where, and in what order (bottom layer first).
 * Sources themselves are live streams shared by every scene; a scene only places them.
 * The key "" holds the arrangement made before any scene exists.
 */
export class SceneSources {
  #scenes = new Map<string, Placement[]>();

  of(scene: string): readonly Placement[] {
    return this.#scenes.get(scene) ?? [];
  }

  has(scene: string, sourceId: string) {
    return this.of(scene).some((item) => item.sourceId === sourceId);
  }

  /** Whether any scene still shows the source. */
  used(sourceId: string) {
    for (const list of this.#scenes.values())
      if (list.some((item) => item.sourceId === sourceId)) return true;
    return false;
  }

  add(scene: string, placement: Placement, at = this.of(scene).length) {
    const list = this.of(scene).filter((item) => item.sourceId !== placement.sourceId);
    const index = Math.max(0, Math.min(at, list.length));
    this.#scenes.set(scene, [...list.slice(0, index), placement, ...list.slice(index)]);
  }

  /** Takes the source off one scene. Returns true when no scene shows it any more. */
  remove(scene: string, sourceId: string) {
    this.#scenes.set(
      scene,
      this.of(scene).filter((item) => item.sourceId !== sourceId),
    );
    return !this.used(sourceId);
  }

  /** Takes the source off every scene, for a stream that ended. */
  forget(sourceId: string) {
    for (const [scene, list] of this.#scenes)
      this.#scenes.set(
        scene,
        list.filter((item) => item.sourceId !== sourceId),
      );
  }

  place(scene: string, sourceId: string, layout: SourceLayout) {
    this.#scenes.set(
      scene,
      this.of(scene).map((item) => (item.sourceId === sourceId ? { ...item, layout } : item)),
    );
  }

  /** Moves a source one layer up (towards the viewer) or down within one scene. */
  restack(scene: string, sourceId: string, step: 1 | -1) {
    const list = [...this.of(scene)];
    const from = list.findIndex((item) => item.sourceId === sourceId);
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

  /** Forgets a scene. Returns the sources that no scene shows any more. */
  drop(scene: string) {
    const list = this.of(scene);
    this.#scenes.delete(scene);
    return list.map((item) => item.sourceId).filter((id) => !this.used(id));
  }
}
