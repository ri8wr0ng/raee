/**
 * Soundboard Store: Pure model, shortcut helpers, validation, and persistence.
 *
 * Persists pads and macros in localStorage ("sidecut.soundboard.v1") and
 * sound audio file bytes in IndexedDB ("sidecut-soundboard", store "sounds").
 */

export type Pad = {
  id: string;
  name: string;
  color: string;
  /** Volume in decibels, clamped to [-30, 6]. */
  volumeDB: number;
  loop: boolean;
  shortcut: string | null;
};

export type MacroStep =
  | { kind: "play"; padId: string }
  | { kind: "stop-all" }
  | { kind: "wait"; ms: number }
  | { kind: "scene"; sceneId: string }
  | { kind: "overlay"; overlayId: string; visible: boolean }
  | { kind: "record"; action: "start" | "stop" }
  | { kind: "mark" };

export type Macro = {
  id: string;
  name: string;
  shortcut: string | null;
  steps: MacroStep[];
};

export type SoundboardData = {
  pads: Pad[];
  macros: Macro[];
};

export const SOUNDBOARD_STORAGE_KEY = "sidecut.soundboard.v1";
export const SOUNDBOARD_DB_NAME = "sidecut-soundboard";
export const SOUNDBOARD_STORE_NAME = "sounds";

export const DEFAULT_PAD_COLORS: readonly string[] = [
  "#ef4444", // Red
  "#f97316", // Orange
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#8b5cf6", // Purple
  "#ec4899", // Pink
];

const LONE_MODIFIER_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "Symbol",
]);

const LONE_MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

/**
 * Maps standard DOM event.code values to clean canonical key names.
 * Uses event.code for digits ("Digit1" -> "1") and letters ("KeyA" -> "A")
 * so keyboard layouts remain stable across international layouts.
 */
export function codeToKeyName(code: string, key?: string): string {
  // Letters: KeyA -> A, KeyZ -> Z
  if (code.startsWith("Key") && code.length === 4) {
    return code.slice(3).toUpperCase();
  }
  // Digits: Digit0 -> 0, Digit9 -> 9
  if (code.startsWith("Digit") && code.length === 6) {
    return code.slice(5);
  }
  // Numpad digits: Numpad0 -> 0 (or fallback to key)
  if (code.startsWith("Numpad") && code.length === 7 && /^\d$/.test(code.slice(6))) {
    return code.slice(6);
  }
  // Function keys: F1 -> F1
  if (/^F\d{1,2}$/i.test(code)) {
    return code.toUpperCase();
  }
  switch (code) {
    case "Space":
      return "Space";
    case "Enter":
    case "NumpadEnter":
      return "Enter";
    case "Escape":
      return "Escape";
    case "Tab":
      return "Tab";
    case "Backspace":
      return "Backspace";
    case "Delete":
      return "Delete";
    case "ArrowUp":
      return "ArrowUp";
    case "ArrowDown":
      return "ArrowDown";
    case "ArrowLeft":
      return "ArrowLeft";
    case "ArrowRight":
      return "ArrowRight";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Backslash":
      return "\\";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "Backquote":
      return "`";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Slash":
      return "/";
    default:
      if (key && key.length === 1 && !LONE_MODIFIER_KEYS.has(key)) {
        return key.toUpperCase();
      }
      return code || (key ?? "");
  }
}

/**
 * Builds a shortcut string like "Ctrl+Shift+1" or "Alt+A" from a KeyboardEvent.
 * Returns null for lone modifier key presses.
 */
export function shortcutFromEvent(event: KeyboardEvent): string | null {
  // Ignore lone modifier keys
  if (LONE_MODIFIER_KEYS.has(event.key) || LONE_MODIFIER_CODES.has(event.code)) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  const keyName = codeToKeyName(event.code, event.key);
  if (!keyName) return null;

  parts.push(keyName);
  return parts.join("+");
}

/**
 * Normalizes a shortcut string to a canonical representation:
 * sorted modifiers in order [Ctrl, Alt, Shift, Meta] followed by the normalized key.
 * E.g. "shift + ctrl + 1" -> "Ctrl+Shift+1".
 */
export function normalizeShortcut(shortcut: string): string {
  const tokens = shortcut
    .split("+")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (tokens.length === 0) return "";

  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  const nonModifiers: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      ctrl = true;
    } else if (lower === "alt") {
      alt = true;
    } else if (lower === "shift") {
      shift = true;
    } else if (lower === "meta" || lower === "cmd" || lower === "command" || lower === "super") {
      meta = true;
    } else {
      nonModifiers.push(token);
    }
  }

  const result: string[] = [];
  if (ctrl) result.push("Ctrl");
  if (alt) result.push("Alt");
  if (shift) result.push("Shift");
  if (meta) result.push("Meta");

  if (nonModifiers.length > 0) {
    const rawKey = nonModifiers.join("+");
    const normalizedKey = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
    result.push(normalizedKey);
  }

  return result.join("+");
}

/**
 * Checks whether a KeyboardEvent matches a given shortcut string.
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string | null | undefined,
): boolean {
  if (!shortcut || !shortcut.trim()) return false;
  const eventShortcut = shortcutFromEvent(event);
  if (!eventShortcut) return false;
  return normalizeShortcut(eventShortcut) === normalizeShortcut(shortcut);
}

export type ConflictItem = {
  type: "pad" | "macro";
  id: string;
  name: string;
};

export type ShortcutConflict = {
  shortcut: string;
  items: ConflictItem[];
};

/**
 * Finds if a candidate shortcut conflicts with an existing pad or macro.
 * excludeId allows checking whether changing a pad/macro's shortcut collides with others.
 */
export function findShortcutConflict(
  pads: readonly Pad[],
  macros: readonly Macro[],
  shortcut: string | null | undefined,
  excludeId?: string,
): ConflictItem | null {
  if (!shortcut || !shortcut.trim()) return null;
  const target = normalizeShortcut(shortcut);
  if (!target) return null;

  for (const pad of pads) {
    if (pad.id === excludeId) continue;
    if (pad.shortcut && normalizeShortcut(pad.shortcut) === target) {
      return { type: "pad", id: pad.id, name: pad.name };
    }
  }

  for (const macro of macros) {
    if (macro.id === excludeId) continue;
    if (macro.shortcut && normalizeShortcut(macro.shortcut) === target) {
      return { type: "macro", id: macro.id, name: macro.name };
    }
  }

  return null;
}

/**
 * Scans all pads and macros to detect all shortcut conflicts.
 */
export function detectShortcutConflicts(
  pads: readonly Pad[],
  macros: readonly Macro[],
): ShortcutConflict[] {
  const map = new Map<string, ConflictItem[]>();

  for (const pad of pads) {
    if (!pad.shortcut || !pad.shortcut.trim()) continue;
    const norm = normalizeShortcut(pad.shortcut);
    if (!norm) continue;
    const list = map.get(norm) ?? [];
    list.push({ type: "pad", id: pad.id, name: pad.name });
    map.set(norm, list);
  }

  for (const macro of macros) {
    if (!macro.shortcut || !macro.shortcut.trim()) continue;
    const norm = normalizeShortcut(macro.shortcut);
    if (!norm) continue;
    const list = map.get(norm) ?? [];
    list.push({ type: "macro", id: macro.id, name: macro.name });
    map.set(norm, list);
  }

  const conflicts: ShortcutConflict[] = [];
  for (const [shortcut, items] of map.entries()) {
    if (items.length > 1) {
      conflicts.push({ shortcut, items });
    }
  }
  return conflicts;
}

export type ValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Validates an individual MacroStep.
 */
export function validateMacroStep(step: unknown): ValidationResult {
  if (!step || typeof step !== "object") {
    return { valid: false, reason: "Step must be an object" };
  }
  const s = step as Record<string, unknown>;
  switch (s.kind) {
    case "play":
      if (typeof s.padId !== "string" || s.padId.trim().length === 0) {
        return { valid: false, reason: "Play step requires non-empty padId" };
      }
      return { valid: true };
    case "stop-all":
      return { valid: true };
    case "wait":
      if (typeof s.ms !== "number" || !Number.isFinite(s.ms) || s.ms < 0) {
        return { valid: false, reason: "Wait step requires non-negative ms number" };
      }
      return { valid: true };
    case "scene":
      if (typeof s.sceneId !== "string" || s.sceneId.trim().length === 0) {
        return { valid: false, reason: "Scene step requires non-empty sceneId" };
      }
      return { valid: true };
    case "overlay":
      if (typeof s.overlayId !== "string" || s.overlayId.trim().length === 0) {
        return { valid: false, reason: "Overlay step requires non-empty overlayId" };
      }
      if (typeof s.visible !== "boolean") {
        return { valid: false, reason: "Overlay step requires visible boolean" };
      }
      return { valid: true };
    case "record":
      if (s.action !== "start" && s.action !== "stop") {
        return { valid: false, reason: "Record step action must be 'start' or 'stop'" };
      }
      return { valid: true };
    case "mark":
      return { valid: true };
    default:
      return { valid: false, reason: `Unknown step kind: ${String(s.kind)}` };
  }
}

export function isValidMacroStep(step: unknown): step is MacroStep {
  return validateMacroStep(step).valid;
}

export function validateMacro(macro: unknown): ValidationResult {
  if (!macro || typeof macro !== "object") {
    return { valid: false, reason: "Macro must be an object" };
  }
  const m = macro as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id.trim().length === 0) {
    return { valid: false, reason: "Macro requires non-empty id" };
  }
  if (typeof m.name !== "string" || m.name.trim().length === 0) {
    return { valid: false, reason: "Macro requires non-empty name" };
  }
  if (m.shortcut !== null && typeof m.shortcut !== "string") {
    return { valid: false, reason: "Macro shortcut must be string or null" };
  }
  if (!Array.isArray(m.steps)) {
    return { valid: false, reason: "Macro steps must be an array" };
  }
  for (let i = 0; i < m.steps.length; i++) {
    const stepResult = validateMacroStep(m.steps[i]);
    if (!stepResult.valid) {
      return { valid: false, reason: `Step ${i}: ${stepResult.reason}` };
    }
  }
  return { valid: true };
}

export function validatePad(pad: unknown): ValidationResult {
  if (!pad || typeof pad !== "object") {
    return { valid: false, reason: "Pad must be an object" };
  }
  const p = pad as Record<string, unknown>;
  if (typeof p.id !== "string" || p.id.trim().length === 0) {
    return { valid: false, reason: "Pad requires non-empty id" };
  }
  if (typeof p.name !== "string" || p.name.trim().length === 0) {
    return { valid: false, reason: "Pad requires non-empty name" };
  }
  if (typeof p.color !== "string" || p.color.trim().length === 0) {
    return { valid: false, reason: "Pad requires color" };
  }
  if (
    typeof p.volumeDB !== "number" ||
    !Number.isFinite(p.volumeDB) ||
    p.volumeDB < -30 ||
    p.volumeDB > 6
  ) {
    return { valid: false, reason: "Pad volumeDB must be between -30 and 6" };
  }
  if (typeof p.loop !== "boolean") {
    return { valid: false, reason: "Pad loop must be boolean" };
  }
  if (p.shortcut !== null && typeof p.shortcut !== "string") {
    return { valid: false, reason: "Pad shortcut must be string or null" };
  }
  return { valid: true };
}

export function createPad(partial: Partial<Pad> & { name: string }): Pad {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    color: partial.color ?? DEFAULT_PAD_COLORS[0]!,
    volumeDB: Math.max(-30, Math.min(6, partial.volumeDB ?? 0)),
    loop: partial.loop ?? false,
    shortcut: partial.shortcut ?? null,
  };
}

export function createMacro(partial: Partial<Macro> & { name: string }): Macro {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    shortcut: partial.shortcut ?? null,
    steps: partial.steps ?? [],
  };
}

// ---------------------------------------------------------------------------
// IndexedDB persistence for audio bytes
// ---------------------------------------------------------------------------

export function isIndexedDBAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

export function openSoundboardDB(): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOUNDBOARD_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SOUNDBOARD_STORE_NAME)) {
        db.createObjectStore(SOUNDBOARD_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves audio bytes (Blob or ArrayBuffer) in IndexedDB keyed by padId.
 */
export async function saveSoundAudio(padId: string, data: Blob | ArrayBuffer): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  const db = await openSoundboardDB();
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUNDBOARD_STORE_NAME, "readwrite");
    const store = tx.objectStore(SOUNDBOARD_STORE_NAME);
    const req = store.put(buffer, padId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Loads audio bytes from IndexedDB for a given padId.
 * Returns null if not found.
 */
export async function loadSoundAudio(padId: string): Promise<ArrayBuffer | null> {
  if (!isIndexedDBAvailable()) return null;
  const db = await openSoundboardDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUNDBOARD_STORE_NAME, "readonly");
    const store = tx.objectStore(SOUNDBOARD_STORE_NAME);
    const req = store.get(padId);
    req.onsuccess = () => {
      const result = req.result;
      if (!result) {
        resolve(null);
      } else if (result instanceof ArrayBuffer) {
        resolve(result);
      } else if (result instanceof Blob) {
        result.arrayBuffer().then(resolve, reject);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Deletes audio bytes from IndexedDB for a given padId.
 */
export async function deleteSoundAudio(padId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  const db = await openSoundboardDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUNDBOARD_STORE_NAME, "readwrite");
    const store = tx.objectStore(SOUNDBOARD_STORE_NAME);
    const req = store.delete(padId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// localStorage persistence for pads and macros JSON
// ---------------------------------------------------------------------------

export function loadSoundboardData(): SoundboardData {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return { pads: [], macros: [] };
  }
  try {
    const raw = localStorage.getItem(SOUNDBOARD_STORAGE_KEY);
    if (!raw) return { pads: [], macros: [] };
    const parsed = JSON.parse(raw);
    const pads: Pad[] = [];
    if (Array.isArray(parsed?.pads)) {
      for (const item of parsed.pads) {
        if (validatePad(item).valid) {
          pads.push(item as Pad);
        }
      }
    }
    const macros: Macro[] = [];
    if (Array.isArray(parsed?.macros)) {
      for (const item of parsed.macros) {
        if (validateMacro(item).valid) {
          macros.push(item as Macro);
        }
      }
    }
    return { pads, macros };
  } catch {
    return { pads: [], macros: [] };
  }
}

export function saveSoundboardData(data: SoundboardData): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SOUNDBOARD_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota or security errors
  }
}
