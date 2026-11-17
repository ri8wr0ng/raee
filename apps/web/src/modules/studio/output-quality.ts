import { useSyncExternalStore } from "react";

/** How Studio records and streams the program: frames per second and largest height. */
export type OutputQuality = { frameRate: 24 | 30 | 60; height: 720 | 1080 | 1440 };

export const FRAME_RATES = [24, 30, 60] as const;
export const OUTPUT_HEIGHTS = [720, 1080, 1440] as const;
export const DEFAULT_OUTPUT_QUALITY: OutputQuality = { frameRate: 30, height: 1080 };

const BASE_BITRATE = { 720: 3_000_000, 1080: 6_000_000, 1440: 12_000_000 } as const;

/** Video bits per second for a quality: more pixels and more frames need more bits. */
export function videoBitrate(quality: OutputQuality) {
  return Math.round(BASE_BITRATE[quality.height] * (quality.frameRate / 30) ** 0.6);
}
export const AUDIO_BITRATE = 160_000;

export const describeQuality = (quality: OutputQuality) =>
  `${quality.height}p · ${quality.frameRate} fps · ${(videoBitrate(quality) / 1_000_000).toFixed(1)} Mbps`;

const KEY = "sidecut.studio.outputQuality";

export function parseOutputQuality(text: string | null): OutputQuality {
  try {
    const value = JSON.parse(text ?? "") as Partial<OutputQuality>;
    return {
      frameRate: FRAME_RATES.includes(value.frameRate as OutputQuality["frameRate"])
        ? (value.frameRate as OutputQuality["frameRate"])
        : DEFAULT_OUTPUT_QUALITY.frameRate,
      height: OUTPUT_HEIGHTS.includes(value.height as OutputQuality["height"])
        ? (value.height as OutputQuality["height"])
        : DEFAULT_OUTPUT_QUALITY.height,
    };
  } catch {
    return DEFAULT_OUTPUT_QUALITY;
  }
}

const listeners = new Set<() => void>();
let current: OutputQuality | null = null;
const read = () => {
  if (current) return current;
  try {
    current = parseOutputQuality(localStorage.getItem(KEY));
  } catch {
    current = DEFAULT_OUTPUT_QUALITY;
  }
  return current;
};

export function setOutputQuality(change: Partial<OutputQuality>) {
  current = { ...read(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Keep the choice for this visit when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

/** The saved output quality, shared by Studio recording and desktop streaming. */
export function useOutputQuality() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => DEFAULT_OUTPUT_QUALITY,
  );
}
