import { useCallback, useEffect, useRef, useState } from "react";
import { sceneHotkeyScene } from "./scene-deck-keys";
import "./scene-deck.css";

export type SceneDeckScene = { id: string; name: string };

const SHORTCUT_LIMIT = 9;

/**
 * Always-visible scene buttons under the program preview. Pressing one — or its
 * digit key — only changes what is on air; the editor's selected scene and any
 * unsaved look draft are left alone.
 */
export function SceneDeck({
  scenes,
  activeId,
  live,
  onSwitch,
}: {
  scenes: readonly SceneDeckScene[];
  activeId: string | null;
  /** Recording or streaming: switches get a pulse and a spoken confirmation. */
  live: boolean;
  onSwitch: (id: string) => void;
}) {
  const [announce, setAnnounce] = useState<{ text: string; nonce: number } | null>(null);
  const [pulse, setPulse] = useState<{ id: string; nonce: number } | null>(null);
  const nonce = useRef(0);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const liveRef = useRef(live);
  liveRef.current = live;
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

  const goLive = useCallback((scene: SceneDeckScene) => {
    if (scene.id === activeRef.current) return;
    nonce.current += 1;
    const mark = nonce.current;
    setAnnounce({ text: `${scene.name} on air`, nonce: mark });
    if (liveRef.current) {
      setPulse({ id: scene.id, nonce: mark });
      // Reduced motion never fires animationend; drop the ring on a timer too.
      setTimeout(() => setPulse((p) => (p?.nonce === mark ? null : p)), 800);
    }
    onSwitchRef.current(scene.id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const index = sceneHotkeyScene(event, scenesRef.current.length);
      const scene = index === null ? undefined : scenesRef.current[index];
      if (!scene) return;
      event.preventDefault();
      goLive(scene);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goLive]);

  if (scenes.length === 0) return null;
  if (scenes.length === 1)
    return <p className="scene-deck-hint">Save another scene to switch between scenes.</p>;

  return (
    <div className="scene-deck-wrap">
      <div className="scene-deck" role="group" aria-label="Scene deck">
        {scenes.map((scene, index) => {
          const onAir = scene.id === activeId;
          const hotkey = index < SHORTCUT_LIMIT ? index + 1 : null;
          const action = onAir ? `${scene.name} is on air` : `Put ${scene.name} on air`;
          return (
            <button
              key={scene.id}
              type="button"
              className="scene-deck-button"
              data-on-air={onAir || undefined}
              aria-pressed={onAir}
              aria-label={hotkey === null ? action : `${action} (${hotkey})`}
              title={hotkey === null ? action : `${action} — press ${hotkey}`}
              onClick={() => goLive(scene)}
            >
              {hotkey !== null && (
                <span className="scene-deck-key" aria-hidden>
                  {hotkey}
                </span>
              )}
              <span className="scene-deck-name">{scene.name}</span>
              {onAir && (
                <span className="scene-deck-live" aria-hidden>
                  On air
                </span>
              )}
              {pulse?.id === scene.id && (
                <span
                  key={pulse.nonce}
                  className="scene-deck-pulse"
                  aria-hidden
                  onAnimationEnd={() => setPulse(null)}
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce && <span key={announce.nonce}>{announce.text}</span>}
      </p>
    </div>
  );
}
