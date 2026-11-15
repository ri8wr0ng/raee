/** Digit keys 1-9 map to the first nine deck buttons, in scene order. */
export function sceneHotkeyIndex(key: string, sceneCount: number): number | null {
  if (sceneCount < 2 || key.length !== 1 || key < "1" || key > "9") return null;
  const index = key.charCodeAt(0) - 49;
  return index < sceneCount ? index : null;
}

/** Typing digits into a field must never cut the program to another scene. */
export function isEditableHotkeyTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    closest?: (selector: string) => unknown;
  };
  if (element.isContentEditable === true) return true;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT")
    return true;
  // Digits typed inside an open menu, listbox or dialog belong to it, not to the program.
  return Boolean(
    element.closest?.(
      '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"],[role="option"]',
    ),
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
    defaultPrevented?: boolean;
  },
  sceneCount: number,
): number | null {
  if (event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (isEditableHotkeyTarget(event.target)) return null;
  return sceneHotkeyIndex(event.key, sceneCount);
}
