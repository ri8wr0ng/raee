import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  moveOverlay,
  nudgeOverlay,
  resizeOverlay,
  type OverlayHandle,
  type OverlayRect,
} from "./overlay-layout";
import "./overlay-stage.css";

export type StageOverlay = {
  id: string;
  /** The overlay's text, shown on the chip and used for its accessible name. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
  /** Fill and text colours, so the box previews the overlay before the look is saved. */
  color?: string | undefined;
  textColor?: string | undefined;
};

const HANDLES: readonly OverlayHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

type Gesture = {
  id: string;
  pointerId: number;
  /** Null while moving the whole overlay. */
  handle: OverlayHandle | null;
  start: OverlayRect;
  origin: { x: number; y: number };
};

const rectOf = (overlay: StageOverlay): OverlayRect => ({
  x: overlay.x,
  y: overlay.y,
  width: overlay.width,
  height: overlay.height,
});

/**
 * Text overlays as handles over the program canvas: drag one to move it, drag a handle to
 * resize it. Hold Alt while dragging to turn off edge snapping. Arrow keys nudge the focused
 * overlay, Escape deselects. Disabled overlays are not shown.
 */
export function OverlayStage({
  overlays,
  selected,
  onSelect,
  onChange,
  disabled,
  standIn = false,
}: {
  overlays: readonly StageOverlay[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, rect: OverlayRect) => void;
  disabled?: boolean | undefined;
  /** Draws DOM stand-ins for when the canvas below isn't painting the draft look. */
  standIn?: boolean | undefined;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const point = (event: PointerEvent) => {
    const box = stage.current!.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    };
  };
  const begin = (
    event: PointerEvent<HTMLElement>,
    overlay: StageOverlay,
    handle: OverlayHandle | null,
  ) => {
    if (disabled || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    (event.currentTarget.closest("[data-overlay]") as HTMLElement | null)?.focus();
    onSelect(overlay.id);
    gesture.current = {
      id: overlay.id,
      pointerId: event.pointerId,
      handle,
      start: rectOf(overlay),
      origin: point(event),
    };
  };
  const move = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const at = point(event);
    onChange(
      active.id,
      active.handle
        ? resizeOverlay(
            active.start,
            active.handle,
            at.x - active.origin.x,
            at.y - active.origin.y,
            !event.altKey,
          )
        : moveOverlay(active.start, at.x - active.origin.x, at.y - active.origin.y, !event.altKey),
    );
  };
  const end = (event: PointerEvent) => {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null;
  };
  const nudge = (event: KeyboardEvent, overlay: StageOverlay) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onSelect(null);
      return;
    }
    const rect = rectOf(overlay);
    const next = nudgeOverlay(rect, event.key, event.shiftKey);
    if (next === rect) return;
    event.preventDefault();
    onChange(overlay.id, next);
  };

  return (
    <div
      ref={stage}
      className="studio-overlay-stage"
      data-disabled={disabled || undefined}
      role="group"
      aria-label="Overlay layout"
      onPointerDown={(event) => {
        if (!disabled && event.target === event.currentTarget) onSelect(null);
      }}
    >
      {overlays
        .filter((overlay) => overlay.enabled)
        .map((overlay) => {
          const isSelected = selected === overlay.id;
          return (
            <div
              key={overlay.id}
              data-overlay
              data-selected={isSelected || undefined}
              role="group"
              tabIndex={disabled ? -1 : 0}
              aria-label={`Overlay: ${overlay.label}. Drag to move, drag a handle to resize, or use the arrow keys.`}
              className="studio-overlay-box"
              style={{
                left: `${overlay.x * 100}%`,
                top: `${overlay.y * 100}%`,
                width: `${overlay.width * 100}%`,
                height: `${overlay.height * 100}%`,
                ["--overlay-fill" as string]: overlay.color ?? "transparent",
                ["--overlay-text" as string]: overlay.textColor ?? "#ffffff",
              }}
              onPointerDown={(event) => begin(event, overlay, null)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onFocus={() => {
                if (!disabled) onSelect(overlay.id);
              }}
              onKeyDown={(event) => {
                if (!disabled) nudge(event, overlay);
              }}
            >
              {standIn && overlay.color && (
                <span className="studio-overlay-preview" aria-hidden>
                  {overlay.label}
                </span>
              )}
              <span className="studio-overlay-tag">{overlay.label}</span>
              {isSelected &&
                !disabled &&
                HANDLES.map((handle) => (
                  <span
                    key={handle}
                    data-handle={handle}
                    className="studio-overlay-handle"
                    aria-hidden
                    onPointerDown={(event) => begin(event, overlay, handle)}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                  />
                ))}
            </div>
          );
        })}
    </div>
  );
}
