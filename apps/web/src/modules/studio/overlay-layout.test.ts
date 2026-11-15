import { describe, expect, it } from "vite-plus/test";
import { moveOverlay, nudgeOverlay, resizeOverlay } from "./overlay-layout";

const RECT = { x: 0.2, y: 0.2, width: 0.4, height: 0.3 };

describe("overlay layout", () => {
  it("moves freely and keeps the whole rect on the canvas", () => {
    const moved = moveOverlay(RECT, 0.1, 0.05);
    expect(moved).toEqual({ x: 0.3, y: 0.25, width: 0.4, height: 0.3 });
    const flung = moveOverlay(RECT, 5, -5);
    expect(flung.x + flung.width).toBeLessThanOrEqual(1);
    expect(flung.y).toBeGreaterThanOrEqual(0);
    const nudgedOff = moveOverlay({ x: 0.9, y: 0.1, width: 0.1, height: 0.1 }, 0.5, 0);
    expect(nudgedOff.x + nudgedOff.width).toBeLessThanOrEqual(1);
  });

  it("snaps edges and centre to canvas lines unless snapping is off", () => {
    const near = { x: 0.012, y: 0.49, width: 0.2, height: 0.2 };
    const moved = moveOverlay(near, 0, 0);
    expect(moved.x).toBe(0);
    const centred = moveOverlay({ x: 0.29, y: 0.3, width: 0.4, height: 0.2 }, 0, 0);
    expect(centred.x + centred.width / 2).toBeCloseTo(0.5);
    const off = moveOverlay(near, 0, 0, false);
    expect(off.x).toBeCloseTo(0.012);
    expect(off.y).toBeCloseTo(0.49);
  });

  it("resizes from every handle without a locked aspect", () => {
    const east = resizeOverlay(RECT, "e", 0.2, 0, false);
    expect(east.x).toBeCloseTo(0.2);
    expect(east.y).toBeCloseTo(0.2);
    expect(east.width).toBeCloseTo(0.6);
    expect(east.height).toBeCloseTo(0.3);
    const west = resizeOverlay(RECT, "w", -0.1, 0, false);
    expect(west.x).toBeCloseTo(0.1);
    expect(west.width).toBeCloseTo(0.5);
    const north = resizeOverlay(RECT, "n", 0, -0.1, false);
    expect(north.y).toBeCloseTo(0.1);
    expect(north.height).toBeCloseTo(0.4);
    const corner = resizeOverlay(RECT, "se", 0.1, -0.05, false);
    expect(corner.width).toBeCloseTo(0.5);
    expect(corner.height).toBeCloseTo(0.25);
    // Free resize: width and height change independently.
    expect(resizeOverlay(RECT, "se", 0.2, 0.01, false).height).toBeCloseTo(0.31);
  });

  it("keeps resized overlays inside the canvas and at minimum size", () => {
    const grown = resizeOverlay(RECT, "se", 5, 5, false);
    expect(grown.x + grown.width).toBeLessThanOrEqual(1);
    expect(grown.y + grown.height).toBeLessThanOrEqual(1);
    const shrunk = resizeOverlay(RECT, "nw", 5, 5, false);
    expect(shrunk.width).toBeGreaterThanOrEqual(0.03);
    expect(shrunk.height).toBeGreaterThanOrEqual(0.03);
    expect(shrunk.x).toBeGreaterThanOrEqual(0);
    const westOff = resizeOverlay({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 }, "w", -5, 0, false);
    expect(westOff.x).toBeGreaterThanOrEqual(0);
    expect(westOff.width).toBeLessThanOrEqual(1);
  });

  it("snaps resized edges to canvas lines", () => {
    const nearRight = resizeOverlay({ x: 0.5, y: 0.2, width: 0.45, height: 0.3 }, "e", 0.04, 0);
    expect(nearRight.x + nearRight.width).toBe(1);
    const nearCentre = resizeOverlay(RECT, "e", -0.095, 0);
    // Right edge 0.6 - 0.095 = 0.505, within snap of the 0.5 centre line.
    expect(nearCentre.x + nearCentre.width).toBe(0.5);
    const noSnap = resizeOverlay(RECT, "e", -0.095, 0, false);
    expect(noSnap.x + noSnap.width).toBeCloseTo(0.505);
  });

  it("nudges with arrow keys, bigger with Shift", () => {
    const small = nudgeOverlay(RECT, "ArrowRight");
    expect(small.x).toBeCloseTo(0.205);
    expect(small.y).toBeCloseTo(0.2);
    const big = nudgeOverlay(RECT, "ArrowDown", true);
    expect(big.y).toBeCloseTo(0.25);
    expect(nudgeOverlay(RECT, "Enter")).toEqual(RECT);
    const atEdge = nudgeOverlay({ x: 0.98, y: 0.5, width: 0.02, height: 0.1 }, "ArrowRight");
    expect(atEdge.x + atEdge.width).toBeLessThanOrEqual(1);
  });
});
