const TAB_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

export function isTabNavigationKey(event: { key: string; target: EventTarget | null }) {
  return (
    TAB_KEYS.has(event.key) &&
    event.target instanceof Element &&
    event.target.closest('[role="tab"]') !== null
  );
}
