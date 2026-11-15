/** Digit keys 1-9 map to the first nine deck buttons, in scene order. */
export function sceneHotkeyIndex(key: string, sceneCount: number): number | null {
  if (sceneCount < 2 || key.length !== 1 || key < "1" || key > "9") return null;
  const index = key.charCodeAt(0) - 49;
  return index < sceneCount ? index : null;
}

/** Typing digits into a field must never cut the program to another scene. */
export function isEditableHotkeyTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return (
    element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT"
  );
}

export function sceneHotkeyScene(
  event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    target: unknown;
  },
  sceneCount: number,
): number | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (isEditableHotkeyTarget(event.target)) return null;
  return sceneHotkeyIndex(event.key, sceneCount);
}
