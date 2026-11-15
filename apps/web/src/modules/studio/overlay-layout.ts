/**
 * Where a text overlay sits on the program canvas.
 *
 * Positions and sizes are fractions of the canvas, so a rect survives output size changes.
 * Unlike sources, overlays resize freely: there is no locked aspect.
 */
export type OverlayRect = { x: number; y: number; width: number; height: number };
export type OverlayHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MIN_SIZE = 0.03;
const SNAP = 0.015;
/** Edge positions an overlay snaps to: canvas edges and the centre lines. */
const SNAP_LINES = [0, 0.5, 1] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Snaps a single edge coordinate to the nearest canvas edge or centre line. */
function snapEdge(value: number): number {
  let best = value;
  let bestDistance = SNAP;
  for (const target of SNAP_LINES) {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

/** Moves an overlay, keeping it fully inside the canvas and snapping edges when asked. */
export function moveOverlay(start: OverlayRect, dx: number, dy: number, snap = true): OverlayRect {
  const { width, height } = start;
  const snapPosition = (value: number, size: number) => {
    if (!snap) return value;
    // Left/right (or top/bottom) edge on a canvas edge or centre line, or the rect centred.
    const targets = [0, 1 - size, 0.5 - size, 0.5, (1 - size) / 2];
    let best = value;
    let bestDistance = SNAP;
    for (const target of targets) {
      const distance = Math.abs(value - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = target;
      }
    }
    return best;
  };
  return {
    x: clamp(snapPosition(start.x + dx, width), 0, 1 - width),
    y: clamp(snapPosition(start.y + dy, height), 0, 1 - height),
    width,
    height,
  };
}

/**
 * Resizes from a handle by a pointer delta, keeping the opposite edges fixed. The rect
 * stays fully inside the canvas and never shrinks below MIN_SIZE on either axis.
 */
export function resizeOverlay(
  start: OverlayRect,
  handle: OverlayHandle,
  dx: number,
  dy: number,
  snap = true,
): OverlayRect {
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  if (west) left += dx;
  if (east) right += dx;
  if (north) top += dy;
  if (south) bottom += dy;
  if (snap) {
    if (west) left = snapEdge(left);
    if (east) right = snapEdge(right);
    if (north) top = snapEdge(top);
    if (south) bottom = snapEdge(bottom);
  }
  left = clamp(left, 0, 1 - MIN_SIZE);
  right = clamp(right, left + MIN_SIZE, 1);
  top = clamp(top, 0, 1 - MIN_SIZE);
  bottom = clamp(bottom, top + MIN_SIZE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Arrow-key nudge: 0.005 of the canvas, or 0.05 with Shift. Returns the rect unchanged for other keys. */
export function nudgeOverlay(rect: OverlayRect, key: string, big = false): OverlayRect {
  const step = big ? 0.05 : 0.005;
  const delta = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }[key];
  if (!delta) return rect;
  return moveOverlay(rect, delta[0]!, delta[1]!, false);
}
