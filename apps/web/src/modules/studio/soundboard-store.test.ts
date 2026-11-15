import { describe, expect, it } from "vite-plus/test";
import {
  codeToKeyName,
  createMacro,
  createPad,
  detectShortcutConflicts,
  findShortcutConflict,
  isValidMacroStep,
  matchesShortcut,
  normalizeShortcut,
  shortcutFromEvent,
  validateMacro,
  validateMacroStep,
  validatePad,
  type Macro,
  type Pad,
} from "./soundboard-store";

function mockKeyEvent(init: {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key ?? "",
    code: init.code ?? "",
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
  } as KeyboardEvent;
}

describe("soundboard-store shortcut handling", () => {
  describe("codeToKeyName", () => {
    it("converts KeyA..KeyZ to uppercase single letters", () => {
      expect(codeToKeyName("KeyA")).toBe("A");
      expect(codeToKeyName("KeyZ")).toBe("Z");
      expect(codeToKeyName("KeyM")).toBe("M");
    });

    it("converts Digit0..Digit9 to digits", () => {
      expect(codeToKeyName("Digit0")).toBe("0");
      expect(codeToKeyName("Digit1")).toBe("1");
      expect(codeToKeyName("Digit9")).toBe("9");
    });

    it("converts function keys and named keys cleanly", () => {
      expect(codeToKeyName("F1")).toBe("F1");
      expect(codeToKeyName("F12")).toBe("F12");
      expect(codeToKeyName("Space")).toBe("Space");
      expect(codeToKeyName("Enter")).toBe("Enter");
      expect(codeToKeyName("Escape")).toBe("Escape");
      expect(codeToKeyName("ArrowUp")).toBe("ArrowUp");
    });
  });

  describe("shortcutFromEvent", () => {
    it("returns null for lone modifier keys", () => {
      expect(shortcutFromEvent(mockKeyEvent({ key: "Shift", code: "ShiftLeft" }))).toBeNull();
      expect(shortcutFromEvent(mockKeyEvent({ key: "Control", code: "ControlLeft" }))).toBeNull();
      expect(shortcutFromEvent(mockKeyEvent({ key: "Alt", code: "AltRight" }))).toBeNull();
      expect(shortcutFromEvent(mockKeyEvent({ key: "Meta", code: "MetaLeft" }))).toBeNull();
      expect(shortcutFromEvent(mockKeyEvent({ key: "CapsLock", code: "CapsLock" }))).toBeNull();
    });

    it("builds 'Ctrl+Shift+1' from modifier combination and Digit1 code", () => {
      const event = mockKeyEvent({
        ctrlKey: true,
        shiftKey: true,
        code: "Digit1",
        key: "!",
      });
      expect(shortcutFromEvent(event)).toBe("Ctrl+Shift+1");
    });

    it("builds shortcuts with letters using event.code for layout stability", () => {
      const event = mockKeyEvent({
        ctrlKey: true,
        code: "KeyA",
        key: "a",
      });
      expect(shortcutFromEvent(event)).toBe("Ctrl+A");
    });

    it("builds bare single-key shortcuts without modifiers", () => {
      expect(shortcutFromEvent(mockKeyEvent({ code: "Digit2", key: "2" }))).toBe("2");
      expect(shortcutFromEvent(mockKeyEvent({ code: "Space", key: " " }))).toBe("Space");
      expect(shortcutFromEvent(mockKeyEvent({ code: "F5", key: "F5" }))).toBe("F5");
    });

    it("sorts modifiers canonically: Ctrl, Alt, Shift, Meta", () => {
      const event = mockKeyEvent({
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        metaKey: true,
        code: "KeyK",
        key: "k",
      });
      expect(shortcutFromEvent(event)).toBe("Ctrl+Alt+Shift+Meta+K");
    });
  });

  describe("normalizeShortcut and matchesShortcut", () => {
    it("normalizes shortcut string order and casing", () => {
      expect(normalizeShortcut("shift + ctrl + 1")).toBe("Ctrl+Shift+1");
      expect(normalizeShortcut("ctrl+a")).toBe("Ctrl+A");
      expect(normalizeShortcut("Alt + Shift + Enter")).toBe("Alt+Shift+Enter");
    });

    it("matches shortcut regardless of input modifier order or whitespace", () => {
      const event = mockKeyEvent({
        ctrlKey: true,
        shiftKey: true,
        code: "Digit1",
        key: "!",
      });
      expect(matchesShortcut(event, "Ctrl+Shift+1")).toBe(true);
      expect(matchesShortcut(event, "shift+ctrl+1")).toBe(true);
      expect(matchesShortcut(event, "Ctrl + Shift + 1")).toBe(true);
    });

    it("does not match when key or modifiers differ", () => {
      const event = mockKeyEvent({
        ctrlKey: true,
        code: "Digit1",
        key: "1",
      });
      expect(matchesShortcut(event, "Ctrl+Shift+1")).toBe(false);
      expect(matchesShortcut(event, "Ctrl+2")).toBe(false);
      expect(matchesShortcut(event, null)).toBe(false);
      expect(matchesShortcut(event, "")).toBe(false);
    });
  });

  describe("conflict detection", () => {
    const pads: Pad[] = [
      createPad({ id: "pad-1", name: "Airhorn", shortcut: "Ctrl+1" }),
      createPad({ id: "pad-2", name: "Applause", shortcut: "Ctrl+2" }),
      createPad({ id: "pad-3", name: "Laugh", shortcut: null }),
    ];
    const macros: Macro[] = [
      createMacro({ id: "macro-1", name: "Intro Sequence", shortcut: "Ctrl+Shift+1" }),
      createMacro({ id: "macro-2", name: "Outro", shortcut: "Ctrl+3" }),
    ];

    it("finds conflict when candidate shortcut matches an existing pad", () => {
      const conflict = findShortcutConflict(pads, macros, "ctrl+1");
      expect(conflict).toEqual({ type: "pad", id: "pad-1", name: "Airhorn" });
    });

    it("finds conflict when candidate shortcut matches an existing macro", () => {
      const conflict = findShortcutConflict(pads, macros, "Ctrl+3");
      expect(conflict).toEqual({ type: "macro", id: "macro-2", name: "Outro" });
    });

    it("ignores self when excludeId is passed", () => {
      const conflict = findShortcutConflict(pads, macros, "Ctrl+1", "pad-1");
      expect(conflict).toBeNull();
    });

    it("returns null when there is no conflict or shortcut is empty", () => {
      expect(findShortcutConflict(pads, macros, "Ctrl+9")).toBeNull();
      expect(findShortcutConflict(pads, macros, null)).toBeNull();
      expect(findShortcutConflict(pads, macros, "")).toBeNull();
    });

    it("detectShortcutConflicts detects duplicate shortcuts in the dataset", () => {
      const collidingPads: Pad[] = [
        ...pads,
        createPad({ id: "pad-dup", name: "Duplicate", shortcut: "ctrl + 1" }),
      ];
      const conflicts = detectShortcutConflicts(collidingPads, macros);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]?.shortcut).toBe("Ctrl+1");
      expect(conflicts[0]?.items).toHaveLength(2);
    });
  });
});

describe("soundboard-store validation", () => {
  describe("validateMacroStep", () => {
    it("validates 'play' step", () => {
      expect(validateMacroStep({ kind: "play", padId: "p1" })).toEqual({ valid: true });
      expect(validateMacroStep({ kind: "play", padId: "" }).valid).toBe(false);
      expect(validateMacroStep({ kind: "play" }).valid).toBe(false);
      expect(isValidMacroStep({ kind: "play", padId: "p1" })).toBe(true);
    });

    it("validates 'stop-all' step", () => {
      expect(validateMacroStep({ kind: "stop-all" })).toEqual({ valid: true });
    });

    it("validates 'wait' step", () => {
      expect(validateMacroStep({ kind: "wait", ms: 500 })).toEqual({ valid: true });
      expect(validateMacroStep({ kind: "wait", ms: 0 })).toEqual({ valid: true });
      expect(validateMacroStep({ kind: "wait", ms: -10 }).valid).toBe(false);
      expect(validateMacroStep({ kind: "wait", ms: NaN }).valid).toBe(false);
      expect(validateMacroStep({ kind: "wait" }).valid).toBe(false);
    });

    it("validates 'scene' step", () => {
      expect(validateMacroStep({ kind: "scene", sceneId: "scene-1" })).toEqual({ valid: true });
      expect(validateMacroStep({ kind: "scene", sceneId: "" }).valid).toBe(false);
      expect(validateMacroStep({ kind: "scene" }).valid).toBe(false);
    });

    it("validates 'overlay' step", () => {
      expect(validateMacroStep({ kind: "overlay", overlayId: "ov-1", visible: true })).toEqual({
        valid: true,
      });
      expect(validateMacroStep({ kind: "overlay", overlayId: "ov-1", visible: false })).toEqual({
        valid: true,
      });
      expect(validateMacroStep({ kind: "overlay", overlayId: "", visible: true }).valid).toBe(
        false,
      );
      expect(validateMacroStep({ kind: "overlay", overlayId: "ov-1" }).valid).toBe(false);
    });

    it("validates 'record' step", () => {
      expect(validateMacroStep({ kind: "record", action: "start" })).toEqual({ valid: true });
      expect(validateMacroStep({ kind: "record", action: "stop" })).toEqual({ valid: true });
      expect(validateMacroStep({ kind: "record", action: "pause" }).valid).toBe(false);
      expect(validateMacroStep({ kind: "record" }).valid).toBe(false);
    });

    it("validates 'mark' step", () => {
      expect(validateMacroStep({ kind: "mark" })).toEqual({ valid: true });
    });

    it("rejects unknown step kinds", () => {
      expect(validateMacroStep({ kind: "unsupported" }).valid).toBe(false);
      expect(validateMacroStep(null).valid).toBe(false);
      expect(validateMacroStep(123).valid).toBe(false);
    });
  });

  describe("validateMacro and validatePad", () => {
    it("validates valid macro with steps", () => {
      const macro = createMacro({
        id: "m1",
        name: "Test Macro",
        shortcut: "Ctrl+M",
        steps: [{ kind: "play", padId: "p1" }, { kind: "wait", ms: 200 }, { kind: "mark" }],
      });
      expect(validateMacro(macro)).toEqual({ valid: true });
    });

    it("rejects macro with invalid step", () => {
      const invalid = {
        id: "m2",
        name: "Invalid",
        shortcut: null,
        steps: [{ kind: "wait", ms: -1 }],
      };
      expect(validateMacro(invalid).valid).toBe(false);
    });

    it("validates pad properties and bounds", () => {
      const pad = createPad({
        id: "pad-valid",
        name: "Horn",
        color: "#f59e0b",
        volumeDB: -6,
        loop: true,
        shortcut: "1",
      });
      expect(validatePad(pad)).toEqual({ valid: true });

      const invalidVol = { ...pad, volumeDB: 20 };
      expect(validatePad(invalidVol).valid).toBe(false);

      const invalidName = { ...pad, name: "" };
      expect(validatePad(invalidName).valid).toBe(false);
    });
  });
});
