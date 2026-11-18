import type { KeyboardEvent } from "react";

const TAB_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

export function isTabNavigationKey(event: { key: string; target: EventTarget | null }) {
  return (
    TAB_KEYS.has(event.key) &&
    event.target instanceof Element &&
    event.target.closest('[role="tab"]') !== null
  );
}

// The window-level arrow handler seeks the playhead unless the key is claimed.
export function claimTabKeys(event: KeyboardEvent<HTMLElement>) {
  if (isTabNavigationKey(event)) event.preventDefault();
}
